import {
  BenzeneStartUpCheckMode,
  BenzeneStartUpCheckOptions,
  IBenzeneServiceContainer,
  ILoggerFactory,
  IServiceResolverFactory,
  IStartUpCheck,
} from '@benzenejs/abstractions';
import { BenzeneStartUpCheckException, StartUpCheckFailure } from './BenzeneStartUpCheckException';

/**
 * Registration and the host-side runner for start-up checks.
 * Port of Benzene.Core.MessageHandlers.StartUpChecks.BenzeneStartUpCheckExtensions (C# fluent extensions →
 * free functions taking the container / factory first).
 *
 * Benzene already had wiring checks in several packages, each opt-in and none of them called by any host.
 * This is the phase those checks were missing: one place, run by every host from its `StartUpRunner`, with
 * failures that survive rather than being swallowed the way warm-up swallows them.
 */

/** The logger category start-up-check failures are logged under in Advisory mode. */
const LOGGER_CATEGORY = 'Benzene.StartUpChecks';

/**
 * Sets what a failing check does. Checks are registered by `addBenzene()` and enforced by default; call
 * this only to soften (Advisory — log and continue) or silence (Disabled) them.
 */
export function addBenzeneStartUpChecks(
  services: IBenzeneServiceContainer,
  mode: BenzeneStartUpCheckMode = BenzeneStartUpCheckMode.Enforce,
): IBenzeneServiceContainer {
  services.addSingletonInstance(BenzeneStartUpCheckOptions, new BenzeneStartUpCheckOptions(mode));
  return services;
}

/**
 * Runs the checks and returns the factory, for use where the factory is built inline (the boot-time
 * `StartUpRunner` and the test host both finish by returning a factory).
 */
export function withStartUpChecks<TFactory extends IServiceResolverFactory>(factory: TFactory): TFactory {
  runStartUpChecks(factory);
  return factory;
}

/**
 * Runs every registered {@link IStartUpCheck} once, on a throwaway scope. Called by every host from its
 * initialization, so a wiring bug is found at boot rather than by the first message that happens to reach
 * the broken link — and by the test host too, which makes the same bug a red unit test.
 *
 * Every failure is reported, not just the first: a wiring mistake often trips several checks, and fixing
 * them one round-trip at a time is the friction this whole phase exists to remove.
 *
 * @throws {BenzeneStartUpCheckException} One or more checks failed and the mode is Enforce.
 */
export function runStartUpChecks(factory: IServiceResolverFactory): void {
  const resolver = factory.createScope();
  try {
    const mode = resolver.tryGetService(BenzeneStartUpCheckOptions)?.mode ?? BenzeneStartUpCheckMode.Enforce;
    if (mode === BenzeneStartUpCheckMode.Disabled) {
      return;
    }

    const failures: StartUpCheckFailure[] = [];
    for (const check of resolver.getServices(IStartUpCheck)) {
      try {
        check.check(resolver);
      } catch (error) {
        failures.push({ name: check.name, error });
      }
    }

    if (failures.length === 0) {
      return;
    }

    if (mode === BenzeneStartUpCheckMode.Advisory) {
      const logger = resolver.tryGetService(ILoggerFactory)?.createLogger(LOGGER_CATEGORY);
      for (const failure of failures) {
        logger?.logError(failure.error, `Benzene start-up check '${failure.name}' failed: ${messageOf(failure.error)}`);
      }
      return;
    }

    throw new BenzeneStartUpCheckException(failures);
  } finally {
    resolver.dispose();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
