import { ServiceToken, serviceToken } from '../DI/ServiceToken';
import { IServiceResolver } from '../DI/IServiceResolver';

/**
 * A wiring check run once during host initialization, before any message is handled.
 * Port of Benzene.Abstractions.StartUpChecks.IStartUpCheck.
 *
 * The sibling of warm-up, and deliberately its opposite in the one way that matters: **a check's
 * exception propagates**. Warm-up is best-effort, so its runner swallows failures — correct for warming,
 * fatal for checking. A check that found a real wiring bug and then had its exception discarded is worse
 * than no check, because the bug still surfaces later, on the message path, with the evidence thrown away.
 *
 * A check runs on a throwaway scope, off the request path, exactly once. It must not dispatch a message or
 * produce side effects — it inspects registrations. Checks obey a single kill switch
 * (`BenzeneStartUpCheckOptions`), so a newcomer who hits a check they believe is wrong can turn the whole
 * thing off in one line.
 *
 * Resolved from the container as a collection, so a merged `ServiceToken` of the same name is declared;
 * register each check with `addSingletonFactory(IStartUpCheck, …)` and collect them with
 * `resolver.getServices(IStartUpCheck)`.
 */
export interface IStartUpCheck {
  /** A short name for this check, used when reporting what failed. */
  readonly name: string;

  /**
   * Runs the check. Throw to report a wiring error; the runner decides, from the configured mode, whether
   * that fails start-up or is logged.
   *
   * @param resolver A throwaway scope to inspect registrations through.
   */
  check(resolver: IServiceResolver): void;
}

export const IStartUpCheck: ServiceToken<IStartUpCheck> = serviceToken<IStartUpCheck>('IStartUpCheck');
