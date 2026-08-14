import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { TransportNames } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewareApplicationWithResult, IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { TransportMiddlewarePipeline } from '@benzenejs/core-message-handlers';
import { BenzeneMessageContext, IBenzeneMessageRequest, IBenzeneMessageResponse } from '@benzenejs/core-messages';
import { MiddlewareApplicationWithResult, MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DuplicateInProcessPipelineException } from './DuplicateInProcessPipelineException';

type Dispatcher = IMiddlewareApplicationWithResult<IBenzeneMessageRequest, IBenzeneMessageResponse>;

/**
 * Accumulates one in-process `BenzeneMessage` pipeline per named module within a single
 * `addInProcessMessaging(...)` call, mirroring how `OutboundRoutingBuilder.route` accumulates one
 * outbound pipeline per topic within a single `addOutboundRouting(...)` call.
 * Port of Benzene.Clients.InProcess.InProcessMessagingBuilder.
 *
 * One call, many `add(...)` calls is the contract, not one `addInProcessMessaging(...)` call per
 * module - see `InProcessMessagingAlreadyRegisteredException` for why.
 */
export class InProcessMessagingBuilder {
  /**
   * The pipeline name used by the parameterless `addInProcessMessaging(configure)` overload and the
   * parameterless `useInProcess(app)` outbound route - a single unnamed pipeline is the
   * `DefaultName` case of "many, named".
   */
  static readonly DefaultName = 'default';

  private readonly pipelines: { name: string; builder: IMiddlewarePipelineBuilder<BenzeneMessageContext> }[] = [];

  constructor(private readonly container: IBenzeneServiceContainer) {}

  /**
   * Registers a named in-process pipeline - typically one module's handlers plus whatever
   * cross-cutting middleware its topics need.
   * @param name The pipeline's name. Matched against the name passed to the outbound route's
   * `useInProcess(app, name)`; each name may be added at most once.
   * @param configure Configures the pipeline - typically at least `useMessageHandlers(...)`.
   */
  add(name: string, configure: PipelineBuilderAction<BenzeneMessageContext>): this;
  /**
   * Registers the single unnamed (`DefaultName`) in-process pipeline - the shape a service with
   * exactly one in-process module uses.
   */
  add(configure: PipelineBuilderAction<BenzeneMessageContext>): this;
  add(
    nameOrConfigure: string | PipelineBuilderAction<BenzeneMessageContext>,
    maybeConfigure?: PipelineBuilderAction<BenzeneMessageContext>,
  ): this {
    const name = typeof nameOrConfigure === 'string' ? nameOrConfigure : InProcessMessagingBuilder.DefaultName;
    const configure = typeof nameOrConfigure === 'string' ? maybeConfigure! : nameOrConfigure;

    const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(this.container);
    configure(builder);
    this.pipelines.push({ name, builder });
    return this;
  }

  /**
   * Builds every registered pipeline and returns the name-keyed dispatcher set.
   * @throws DuplicateInProcessPipelineException The same name was added more than once.
   */
  build(): Map<string, Dispatcher> {
    const seen = new Set<string>();
    for (const { name } of this.pipelines) {
      if (seen.has(name)) {
        throw new DuplicateInProcessPipelineException(name);
      }
      seen.add(name);
    }

    const dispatchers = new Map<string, Dispatcher>();
    for (const { name, builder } of this.pipelines) {
      const pipeline = builder.build();
      // Built directly against MiddlewareApplicationWithResult rather than BenzeneMessageApplication:
      // that convenience class hard-codes the "benzene" transport tag (TransportNames.Benzene) via
      // its own TransportMiddlewarePipeline, which would misreport every in-process pipeline as the
      // wire-exposing "benzene" transport. Tagging TransportNames.InProcess ourselves here is the
      // whole reason to build the pieces directly instead - matching .NET's AddInProcessMessaging,
      // which does the same for the identical reason.
      const taggedPipeline = new TransportMiddlewarePipeline<BenzeneMessageContext>(TransportNames.InProcess, pipeline);
      dispatchers.set(
        name,
        new MiddlewareApplicationWithResult<IBenzeneMessageRequest, BenzeneMessageContext, IBenzeneMessageResponse>(
          taggedPipeline,
          (event) => new BenzeneMessageContext(event),
          (context) => context.benzeneMessageResponse,
        ),
      );
    }
    return dispatchers;
  }
}
