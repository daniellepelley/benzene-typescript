/** Port of Benzene.RabbitMq.RabbitMqConnectionFactory. */
import { ChannelModel, connect, Options } from 'amqplib';
import { IRabbitMqConnectionFactory } from './IRabbitMqConnectionFactory';

/**
 * The default {@link IRabbitMqConnectionFactory}: opens a connection from a supplied AMQP URL (e.g.
 * `amqp://user:pass@host:5672/`) or `amqplib` connect options. Automatic recovery is amqplib's own
 * responsibility of the caller (amqplib does not auto-recover by default — a supervising host restarts a
 * dropped worker), so the URL/options is all this factory needs.
 *
 * PORTING NOTE: .NET's `RabbitMqConnectionFactory` wraps a `ConnectionFactory` (or a `Uri`) and calls
 * `CreateConnectionAsync`. amqplib has no `ConnectionFactory` type — the connection settings are the
 * argument to `amqplib.connect(url, socketOptions)` — so this port wraps that URL/options (plus optional
 * socket options) and calls `connect`.
 */
export class RabbitMqConnectionFactory implements IRabbitMqConnectionFactory {
  private readonly url: string | Options.Connect;
  private readonly socketOptions?: unknown;

  /**
   * Initializes a new instance from an AMQP URL (e.g. `amqp://user:pass@host:5672/`) or `amqplib` connect
   * options (host, credentials, vhost, TLS, …).
   *
   * @param url The AMQP URL or connect options to open the connection from.
   * @param socketOptions Optional socket options forwarded to `amqplib.connect` (e.g. TLS material).
   */
  constructor(url: string | Options.Connect, socketOptions?: unknown) {
    this.url = url;
    this.socketOptions = socketOptions;
  }

  createConnectionAsync(_cancellationToken?: AbortSignal): Promise<ChannelModel> {
    return connect(this.url, this.socketOptions);
  }
}
