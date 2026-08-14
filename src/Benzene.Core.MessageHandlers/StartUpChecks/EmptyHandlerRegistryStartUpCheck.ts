import { ILoggerFactory, IServiceResolver, IStartUpCheck } from '@benzenejs/abstractions';
import { IMessageHandlersFinder } from '@benzenejs/abstractions-message-handlers';

/** The logger category empty-registry warnings are logged under. */
const LOGGER_CATEGORY = 'Benzene.StartUpChecks';

/**
 * A service that registered handler dispatch and then discovered no handlers at all.
 * Port of Benzene.Core.MessageHandlers.StartUpChecks.EmptyHandlerRegistryStartUpCheck.
 *
 * Almost always means `addMessageHandlers(...)` was given the wrong module — the mistake compiles and looks
 * wired, and every message then fails to route with a 404 / "no handler found" that reads like a routing
 * problem rather than a registration one.
 *
 * **Logs rather than throws**, deliberately: a mesh-collector- or probe-only deployable with zero handlers
 * is a real shape, and one codebase frequently builds several deployables that each mount a subset. A check
 * that hard-fails a legitimate arrangement is worse than the bug it prevents.
 */
export class EmptyHandlerRegistryStartUpCheck implements IStartUpCheck {
  readonly name = 'empty-handler-registry';

  check(resolver: IServiceResolver): void {
    const finder = resolver.tryGetService(IMessageHandlersFinder);
    if (finder === undefined || finder.findDefinitions().length > 0) {
      return;
    }

    resolver
      .tryGetService(ILoggerFactory)
      ?.createLogger(LOGGER_CATEGORY)
      .logError(
        undefined,
        'No message handlers were discovered. If this service is meant to handle messages, check that ' +
          'addMessageHandlers(...) was given the module containing your handlers — passing the wrong one ' +
          'compiles and looks wired, and every message then fails to route. Ignore this if the service ' +
          'deliberately has no handlers (a probe- or collector-only deployable).',
      );
  }
}
