import { Context } from 'aws-lambda';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { BenzeneException } from '@benzenejs/core';
import { AwsEventStreamContext } from './AwsEventStream/AwsEventStreamContext';
import { AwsEventPredicate } from './AwsEventPredicates';
import { IAwsLambdaEntryPoint } from './IAwsLambdaEntryPoint';
import { InlineAwsLambdaStartUp } from './InlineAwsLambdaStartUp';

interface CompositeRoute {
  readonly canHandle: AwsEventPredicate;
  readonly entryPoint: IAwsLambdaEntryPoint;
}

/**
 * A single `IAwsLambdaEntryPoint` that dispatches a Lambda's several triggers to the right per-transport
 * entry point — the "one Lambda function, multiple triggers, one warm pool" deployment (the AWS analog of
 * .NET's single stream-sniffing entry point). AWS sends each trigger's event shape to the one exported
 * `handler`; the composite picks the first route whose `canHandle` matches and delegates to that route's
 * entry point.
 *
 * WHY separate entry points (not one pipeline): under type erasure two transports can't share one DI
 * container (their message getters register under the same token and overwrite each other — see the
 * README's "one transport per entry point"). So each route is its own container/pipeline, isolated. They
 * still share the composite's `configureServices` registrations — and any registered *instance* is the
 * same object in every route (a genuinely shared singleton), whereas a factory singleton is built once per
 * route. All routes live in one process and are served by one warm execution environment.
 */
export class CompositeAwsLambdaEntryPoint implements IAwsLambdaEntryPoint {
  constructor(private readonly routes: readonly CompositeRoute[]) {}

  async functionHandlerAsync(event: unknown, context: Context): Promise<unknown> {
    const route = this.routes.find((r) => matches(r.canHandle, event));
    if (route !== undefined) {
      return route.entryPoint.functionHandlerAsync(event, context);
    }
    throw new BenzeneException(
      'The event type has not been recognized. It is possible that there isn\'t a pipeline set up that can handle this event type, or the JSON for the event is not complete, for instance the EventSource field is missing',
    );
  }

  dispose(): void {
    for (const route of this.routes) {
      route.entryPoint.dispose();
    }
  }
}

function matches(predicate: AwsEventPredicate, event: unknown): boolean {
  try {
    return predicate(event);
  } catch {
    // A malformed event must not crash dispatch — it simply matches no route (-> "not recognized").
    return false;
  }
}

/**
 * Builds a {@link CompositeAwsLambdaEntryPoint}. `configureServices` runs against every route's container
 * (shared business services); each `route(canHandle, configure)` adds one transport, built as its own
 * entry point. Pair the `canHandle` with a matching predicate from `AwsEventPredicates`
 * (`isApiGatewayEvent`, `isSqsEvent`, …).
 */
export class CompositeAwsLambdaBuilder {
  private readonly serviceActions: ((services: IBenzeneServiceContainer) => void)[] = [];
  private readonly routeConfigs: {
    canHandle: AwsEventPredicate;
    configure: PipelineBuilderAction<AwsEventStreamContext>;
  }[] = [];

  /** Registers services into every route's container. Call it as many times as needed. */
  configureServices(action: (services: IBenzeneServiceContainer) => void): this {
    this.serviceActions.push(action);
    return this;
  }

  /** Adds a transport route: `canHandle` selects the event shape, `configure` wires that transport's pipeline. */
  route(
    canHandle: AwsEventPredicate,
    configure: PipelineBuilderAction<AwsEventStreamContext>,
  ): this {
    this.routeConfigs.push({ canHandle, configure });
    return this;
  }

  build(): CompositeAwsLambdaEntryPoint {
    const shared = (services: IBenzeneServiceContainer) => {
      for (const action of this.serviceActions) {
        action(services);
      }
    };

    const routes = this.routeConfigs.map(({ canHandle, configure }) => ({
      canHandle,
      entryPoint: new InlineAwsLambdaStartUp().configureServices(shared).configure(configure).build(),
    }));

    return new CompositeAwsLambdaEntryPoint(routes);
  }
}

/**
 * Fluent entry point for building a composite Lambda handler:
 *
 * ```ts
 * const entryPoint = compositeAwsLambda((c) => {
 *   c.configureServices((s) => addBenzene(s));
 *   c.route(isApiGatewayEvent, (app) => useApiGateway(app, (api) => useMessageHandlers(api, HttpHandler)));
 *   c.route(isSqsEvent,        (app) => useSqs(app, (sqs) => useMessageHandlers(sqs, QueueHandler)));
 * });
 * export const handler = toLambdaHandler(entryPoint);
 * ```
 */
export function compositeAwsLambda(
  configure: (builder: CompositeAwsLambdaBuilder) => void,
): CompositeAwsLambdaEntryPoint {
  const builder = new CompositeAwsLambdaBuilder();
  configure(builder);
  return builder.build();
}
