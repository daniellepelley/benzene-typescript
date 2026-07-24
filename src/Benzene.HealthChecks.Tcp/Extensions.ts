/** Port of Benzene.HealthChecks.Tcp.Extensions. */
import { addHealthCheckFactory, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { TcpHealthCheckFactory } from './TcpHealthCheckFactory';

/**
 * Registration helper for `TcpHealthCheck`. C# extension method becomes a free function.
 * Registers a check that connects to `host`:`port` and reports healthy if the connection is accepted.
 */
export function addTcpPing(
  builder: IHealthCheckBuilder,
  host: string,
  port: number,
): IHealthCheckBuilder {
  return addHealthCheckFactory(builder, new TcpHealthCheckFactory(host, port));
}
