import { IServiceResolver, IStartUpCheck } from '@benzenejs/abstractions';
import { InProcessDispatcherRegistry } from './InProcessDispatcherRegistry';
import { InProcessRouteReference } from './InProcessRouteReference';
import { MissingInProcessPipelineException } from './MissingInProcessPipelineException';

/**
 * Every `useInProcess(name)` route names a pipeline that was actually registered via
 * `addInProcessMessaging(...)`.
 * Port of Benzene.Clients.InProcess.InProcessRouteStartUpCheck.
 *
 * Deliberately narrower than "every routed topic has a matching handler": what is knowable at start-up
 * without threading each route's topic through is which **pipeline names** were referenced — one
 * {@link InProcessRouteReference} is recorded per `useInProcess(name)` call — and this catches the
 * missing/misspelled ones (a typo, or a forgotten `addInProcessMessaging(...)`) at start-up instead of first
 * send. Per-topic handler existence remains an honest not-found at first send, as any other transport's
 * unrouted topic already is.
 */
export class InProcessRouteStartUpCheck implements IStartUpCheck {
  readonly name = 'in-process-routes';

  check(resolver: IServiceResolver): void {
    const referencedNames = [...new Set(resolver.getServices(InProcessRouteReference).map((r) => r.pipelineName))];
    if (referencedNames.length === 0) {
      return;
    }

    const registeredNames = resolver.tryGetService(InProcessDispatcherRegistry)?.names ?? [];
    const missingNames = referencedNames.filter((n) => !registeredNames.includes(n)).sort();

    if (missingNames.length > 0) {
      throw new MissingInProcessPipelineException(missingNames, registeredNames);
    }
  }
}
