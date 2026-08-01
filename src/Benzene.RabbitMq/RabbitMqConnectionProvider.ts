/** Port of Benzene.RabbitMq.IRabbitMqConnectionProvider / RabbitMqConnectionProvider. */
import { ChannelModel } from 'amqplib';
import { IRabbitMqConnectionFactory } from './IRabbitMqConnectionFactory';

/**
 * Supplies the connection (amqplib `ChannelModel`) the {@link RabbitMqHealthCheck} uses. The health check
 * opens ONE connection through this provider and reuses it across probes — opening a connection per probe
 * would re-run the TCP + AMQP handshake at scrape cadence. The worker owns its own consume connection
 * privately, so the health check uses a dedicated (still single, still reused) connection rather than
 * sharing the worker's; the check opens only a cheap short-lived *channel* per probe on this connection.
 */
export interface IRabbitMqConnectionProvider {
  /** Returns the reused connection, opening (or re-opening a dropped) one as needed. */
  getConnectionAsync(cancellationToken?: AbortSignal): Promise<ChannelModel>;

  /**
   * Closes the one reused connection. Port of C#'s `IAsyncDisposable.DisposeAsync`. An open amqplib
   * connection keeps a heartbeat interval timer alive, which holds Node's event loop open; a host that
   * has stopped consuming should call this so the process can exit cleanly. Optional so a bespoke
   * provider need not implement it.
   */
  disposeAsync?(): Promise<void>;
}

/**
 * Default {@link IRabbitMqConnectionProvider}: lazily opens one connection via an
 * {@link IRabbitMqConnectionFactory} and reuses it. Unlike a cached promise, a **failed** connect is not
 * memoised — the next probe retries — and a connection that has since dropped is disposed and re-opened.
 *
 * ADAPTATION: C#'s `IConnection.IsOpen` has no amqplib counterpart; the port tracks liveness by listening
 * for the `ChannelModel`'s `close`/`error` events. The C# `SemaphoreSlim` gate becomes a small
 * promise-chain mutex so two concurrent probes can't both open a connection.
 */
export class RabbitMqConnectionProvider implements IRabbitMqConnectionProvider {
  private connection: ChannelModel | undefined;
  private open = false;
  private mutex: Promise<unknown> = Promise.resolve();

  constructor(private readonly connectionFactory: IRabbitMqConnectionFactory) {}

  getConnectionAsync(cancellationToken?: AbortSignal): Promise<ChannelModel> {
    // Fast path: an already-open connection, no lock.
    if (this.connection !== undefined && this.open) {
      return Promise.resolve(this.connection);
    }
    // Serialize opens through the mutex so a concurrent probe doesn't open a second connection.
    const run = this.mutex.then(() => this.openLocked(cancellationToken));
    // Keep the chain alive regardless of this attempt's outcome.
    this.mutex = run.catch(() => undefined);
    return run;
  }

  private async openLocked(cancellationToken?: AbortSignal): Promise<ChannelModel> {
    if (this.connection !== undefined && this.open) {
      return this.connection;
    }

    // Dispose a dropped connection before re-opening.
    if (this.connection !== undefined) {
      await this.connection.close().catch(() => undefined);
      this.connection = undefined;
      this.open = false;
    }

    // A throw here leaves `connection` undefined, so the next probe retries rather than caching a fault.
    const connection = await this.connectionFactory.createConnectionAsync(cancellationToken);
    this.open = true;
    connection.once('close', () => {
      this.open = false;
    });
    connection.once('error', () => {
      this.open = false;
    });
    this.connection = connection;
    return connection;
  }

  /**
   * Closes the one reused connection, best-effort. Port of C#'s `IAsyncDisposable.DisposeAsync`. Safe to
   * call more than once and safe to call when no connection was ever opened.
   */
  async disposeAsync(): Promise<void> {
    if (this.connection !== undefined) {
      await this.connection.close().catch(() => undefined);
      this.connection = undefined;
      this.open = false;
    }
  }
}
