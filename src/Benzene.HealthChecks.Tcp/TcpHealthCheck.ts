/** Port of Benzene.HealthChecks.Tcp.TcpHealthCheck. */
import { connect, Socket } from 'node:net';
import {
  HealthCheckDependency,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzene/health-checks-core';

/**
 * Verifies a dependency is reachable at the L4 (TCP) level by opening a connection to a host and port -
 * the lowest-common-denominator check for anything without a first-class client (a database port, an
 * SMTP server, a custom service). Healthy if the connection is accepted; unhealthy on any socket error.
 *
 * `System.Net.Sockets.TcpClient.ConnectAsync` -> `node:net`'s `connect`. .NET's ambient
 * `ICancellationTokenAccessor` (resolved from DI by the factory) has no ported DI seam yet, so - as
 * elsewhere in the port - `CancellationToken` becomes an optional `AbortSignal` passed directly to the
 * constructor; when supplied it aborts the connect attempt. See the factory's note.
 */
export class TcpHealthCheck implements IHealthCheck {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly signal?: AbortSignal,
  ) {}

  get type(): string {
    return 'Tcp';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Tcp', `${this.host}:${this.port}`)];

    try {
      await this.tryConnect();

      return HealthCheckResult.createInstance(
        true,
        this.type,
        { Host: this.host, Port: this.port },
        dependencies,
      );
    } catch (ex) {
      // Report the failure type, not the message (a message can carry infra detail); an expected
      // "connection refused" is a failed result, not a thrown exception.
      return HealthCheckResult.createInstance(
        false,
        this.type,
        { Host: this.host, Port: this.port, Error: errorName(ex) },
        dependencies,
      );
    }
  }

  private tryConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket: Socket = connect({ host: this.host, port: this.port, signal: this.signal });
      const done = (err?: Error): void => {
        socket.removeAllListeners();
        socket.destroy();
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };
      socket.once('connect', () => done());
      socket.once('error', (err) => done(err));
    });
  }
}

/** Mirrors C#'s `ex.GetType().Name` - the constructor name of the thrown value. */
function errorName(ex: unknown): string {
  if (ex instanceof Error) {
    return ex.name;
  }
  return typeof ex;
}
