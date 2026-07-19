/** Port of Benzene.HealthChecks.Core.HealthCheckResult. */
import { HealthCheckDependency } from './HealthCheckDependency';
import { HealthCheckStatus } from './HealthCheckStatus';
import { IHealthCheckResult } from './IHealthCheckResult';

/**
 * Default `IHealthCheckResult` implementation, with factory methods covering the common status
 * combinations.
 */
export class HealthCheckResult implements IHealthCheckResult {
  /** The `type` used by the parameterless `createInstance` overload, for callers without a meaningful check identifier. */
  static readonly unknownType = 'Unknown';

  readonly status: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly dependencies: HealthCheckDependency[];

  /**
   * C#'s single constructor with an optional `dependencies` parameter ports directly.
   * @param dependencies Defaults to none (C# `?? Array.Empty<...>()`).
   */
  constructor(
    status: string,
    type: string,
    data: Record<string, unknown>,
    dependencies?: HealthCheckDependency[],
  ) {
    this.status = status;
    this.type = type;
    this.data = data;
    this.dependencies = dependencies ?? [];
  }

  /**
   * Creates a result, status `ok` if `success`, otherwise `failed`.
   *
   * The C# `CreateInstance` overloads on `(bool)`, `(bool, type)`, `(bool, type, data)`, and
   * `(bool, type, data, dependencies)` collapse into this one method with optional parameters
   * (`type` defaulting to `unknownType`, `data` to an empty object). The C# `Task<bool>` overload
   * cannot share this signature once awaited, so it splits by name as {@link createInstanceAsync}.
   */
  static createInstance(
    success: boolean,
    type: string = HealthCheckResult.unknownType,
    data: Record<string, unknown> = {},
    dependencies?: HealthCheckDependency[],
  ): IHealthCheckResult {
    return new HealthCheckResult(
      success ? HealthCheckStatus.ok : HealthCheckStatus.failed,
      type,
      data,
      dependencies,
    );
  }

  /**
   * Awaits `success` and creates the corresponding result with no diagnostic data.
   * Port of the C# `CreateInstance(Task<bool>, type)` overload, renamed to disambiguate from the
   * synchronous {@link createInstance} (C# distinguishes them by the `Task<bool>` parameter type,
   * which erases in TypeScript).
   */
  static async createInstanceAsync(success: Promise<boolean>, type: string): Promise<IHealthCheckResult> {
    return HealthCheckResult.createInstance(await success, type, {});
  }

  /**
   * Creates a `warning` result - a degraded-but-not-failed outcome that does not flip an aggregated
   * response's `isHealthy` to false. The C# `CreateWarning(type)`, `CreateWarning(type, data)`, and
   * `CreateWarning(type, data, dependencies)` overloads collapse into this one.
   */
  static createWarning(
    type: string,
    data: Record<string, unknown> = {},
    dependencies?: HealthCheckDependency[],
  ): IHealthCheckResult {
    return new HealthCheckResult(HealthCheckStatus.warning, type, data, dependencies);
  }
}
