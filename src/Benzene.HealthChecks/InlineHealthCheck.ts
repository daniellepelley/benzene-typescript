/** Port of Benzene.HealthChecks.InlineHealthCheck. */
import { IHealthCheck, IHealthCheckResult } from '@benzene/health-checks-core';

/**
 * An `IHealthCheck` whose result is produced by an arbitrary delegate, allowing a check to be defined
 * inline (e.g. via the inline `addHealthCheck*` helpers) without writing a dedicated class.
 *
 * C# has two constructors: `(func)` with an empty `Type`, and `(type, func)`. TypeScript cannot
 * overload constructors on parameter count in a way that reads as cleanly, so `type` is an optional
 * leading parameter defaulting to `''` (the C# empty-type behaviour).
 */
export class InlineHealthCheck implements IHealthCheck {
  readonly type: string;
  private readonly func: () => Promise<IHealthCheckResult>;

  constructor(func: () => Promise<IHealthCheckResult>);
  constructor(type: string, func: () => Promise<IHealthCheckResult>);
  constructor(
    typeOrFunc: string | (() => Promise<IHealthCheckResult>),
    func?: () => Promise<IHealthCheckResult>,
  ) {
    if (typeof typeOrFunc === 'string') {
      this.type = typeOrFunc;
      this.func = func!;
    } else {
      this.type = '';
      this.func = typeOrFunc;
    }
  }

  executeAsync(): Promise<IHealthCheckResult> {
    return this.func();
  }
}
