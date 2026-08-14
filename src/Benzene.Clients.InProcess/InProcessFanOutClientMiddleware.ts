import {
  ILogger,
  ILoggerFactory,
  ISerializer,
  IServiceResolverFactory,
  NullLoggerFactory,
  VoidResult,
} from '@benzenejs/abstractions';
import { IMiddleware, IMiddlewareApplicationWithResult, NextFunc } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { IBenzeneMessageRequest, IBenzeneMessageResponse } from '@benzenejs/core-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import { buildInProcessRequest } from './InProcessRequestBuilder';
import { InProcessDispatcherRegistry } from './InProcessDispatcherRegistry';
import { InProcessFanOutTarget } from './InProcessFanOutTarget';

type Dispatcher = IMiddlewareApplicationWithResult<IBenzeneMessageRequest, IBenzeneMessageResponse>;

/**
 * Middleware that dispatches one outbound send to several named in-process pipelines concurrently,
 * each under its own `InProcessFanOutTarget.topic` - the in-monolith equivalent of SNS fanning one
 * topic out to several subscribers. Terminates the outbound pipeline directly against
 * `OutboundContext` (no context conversion needed: unlike a single-target `useInProcess(name)`,
 * there is no one target response to map back).
 * Port of Benzene.Clients.InProcess.InProcessFanOutClientMiddleware.
 *
 * See `InProcessFanOutTarget`/`DuplicateInProcessFanOutTargetException` for why each target
 * dispatches under its own topic rather than the route's literal topic.
 */
export class InProcessFanOutClientMiddleware implements IMiddleware<OutboundContext> {
  readonly name = 'InProcessFanOutClientMiddleware';
  private readonly logger: ILogger;

  constructor(
    private readonly targets: readonly InProcessFanOutTarget[],
    private readonly registry: InProcessDispatcherRegistry,
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly serializer: ISerializer,
    loggerFactory?: ILoggerFactory,
  ) {
    this.logger = (loggerFactory ?? NullLoggerFactory.instance).createLogger('InProcessFanOutClientMiddleware');
  }

  async handleAsync(context: OutboundContext, _next: NextFunc): Promise<void> {
    // Resolve every target's dispatcher up front, outside the per-consumer try/catch below: a
    // typo'd or unregistered pipeline name is a wiring mistake (the same
    // InProcessPipelineNotFoundException a single-target useInProcess(name) throws), not a consumer
    // failure to isolate and swallow.
    const dispatches = this.targets.map((target) => ({
      target,
      dispatcher: this.registry.resolve(target.pipelineName),
      request: buildInProcessRequest(context, this.serializer, target.topic),
    }));

    await Promise.all(dispatches.map((d) => this.dispatchOne(d.target, d.dispatcher, d.request)));

    // Unconditional success once accepted - matching what a real SNS publish returns (no visibility
    // into subscriber outcomes). Void-only, same as every other TS outbound transport today - see
    // InProcessContextConverter's PORT DIVERGENCE note.
    context.response = BenzeneResult.ok<VoidResult>(new VoidResult());
  }

  private async dispatchOne(
    target: InProcessFanOutTarget,
    dispatcher: Dispatcher,
    request: IBenzeneMessageRequest,
  ): Promise<void> {
    try {
      const response = await dispatcher.handleAsync(request, this.serviceResolverFactory);
      if (!BenzeneResultStatus.isSuccess(response.statusCode)) {
        // A baseline failure signal even when no logging middleware is wired on the consumer's own
        // pipeline. There is no in-process DLQ, so this is the only place the failure is visible.
        this.logger.logWarning(
          `In-process fan-out consumer '${target.pipelineName}' returned unsuccessful status ` +
            `${response.statusCode} for topic ${target.topic}`,
        );
      }
    } catch (error) {
      // Isolated from the other consumers and from the caller by design - one failing reaction must
      // not affect delivery to the others or the fan-out's own (always-success) response.
      this.logger.logError(
        error,
        `In-process fan-out consumer '${target.pipelineName}' threw for topic ${target.topic}`,
      );
    }
  }
}
