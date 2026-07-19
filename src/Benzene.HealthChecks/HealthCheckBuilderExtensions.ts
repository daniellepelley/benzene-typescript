/** Port of Benzene.HealthChecks.HealthCheckBuilderExtensions. */
import { IServiceResolver } from '@benzene/abstractions';
import {
  HealthCheckResult,
  IHealthCheckBuilder,
  IHealthCheckResult,
} from '@benzene/health-checks-core';
import { InlineHealthCheck } from './InlineHealthCheck';

/**
 * Convenience helpers for registering a health check as an inline function against an
 * `IHealthCheckBuilder`, without writing a dedicated `IHealthCheck` class. Each builds an
 * `InlineHealthCheck` under the hood. C# extension methods become free functions.
 *
 * C# overload collapse: each C# helper appears twice, once with a synchronous delegate and once with
 * a `Task`-returning one (indistinguishable once TypeScript erases the delegate type). The port keeps
 * one function per named variant, whose delegate may return either the value or a `Promise` of it;
 * `Promise.resolve` normalizes both. The named/unnamed and result/bool distinctions - genuinely
 * different call shapes - stay as separate functions.
 */

/** Registers a named inline health check that produces its result (sync or async). */
export function addInlineHealthCheckWithType(
  source: IHealthCheckBuilder,
  type: string,
  func: (resolver: IServiceResolver) => IHealthCheckResult | Promise<IHealthCheckResult>,
): IHealthCheckBuilder {
  return source.addHealthCheckFn(
    (resolver) => new InlineHealthCheck(type, () => Promise.resolve(func(resolver))),
  );
}

/** Registers an unnamed (empty-type) inline health check that produces its result (sync or async). */
export function addInlineHealthCheck(
  source: IHealthCheckBuilder,
  func: (resolver: IServiceResolver) => IHealthCheckResult | Promise<IHealthCheckResult>,
): IHealthCheckBuilder {
  return source.addHealthCheckFn(
    (resolver) => new InlineHealthCheck(() => Promise.resolve(func(resolver))),
  );
}

/** Registers a named inline health check that reports success/failure as a boolean (sync or async). */
export function addBoolHealthCheckWithType(
  source: IHealthCheckBuilder,
  type: string,
  func: (resolver: IServiceResolver) => boolean | Promise<boolean>,
): IHealthCheckBuilder {
  return source.addHealthCheckFn(
    (resolver) =>
      new InlineHealthCheck(type, async () =>
        HealthCheckResult.createInstance(await func(resolver), type),
      ),
  );
}

/** Registers an unnamed (type "inline") inline health check that reports success/failure as a boolean (sync or async). */
export function addBoolHealthCheck(
  source: IHealthCheckBuilder,
  func: (resolver: IServiceResolver) => boolean | Promise<boolean>,
): IHealthCheckBuilder {
  return source.addHealthCheckFn(
    (resolver) =>
      new InlineHealthCheck(async () =>
        HealthCheckResult.createInstance(await func(resolver), 'inline'),
      ),
  );
}
