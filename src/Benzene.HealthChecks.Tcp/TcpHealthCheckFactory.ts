/** Port of Benzene.HealthChecks.Tcp.TcpHealthCheckFactory. */
import { IServiceResolver } from '@benzene/abstractions';
import { IHealthCheck, IHealthCheckFactory } from '@benzene/health-checks-core';
import { TcpHealthCheck } from './TcpHealthCheck';

/**
 * Builds a `TcpHealthCheck` for a fixed host/port.
 *
 * The C# factory resolves the ambient `ICancellationTokenAccessor` from DI (`resolver
 * .TryGetService<ICancellationTokenAccessor>()`) and hands its token to the check. That
 * scoped-cancellation DI seam is not ported yet, so `create` ignores the resolver and constructs the
 * check with no `AbortSignal`; once an ambient-signal accessor is ported, resolve it here and pass it
 * through - the constructor already accepts one.
 */
export class TcpHealthCheckFactory implements IHealthCheckFactory {
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  create(_resolver: IServiceResolver): IHealthCheck {
    return new TcpHealthCheck(this.host, this.port);
  }
}
