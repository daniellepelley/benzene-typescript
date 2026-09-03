import {
  IBenzeneResultOf,
  ILogger,
  ISerializer,
  IServiceResolver,
  IServiceResolverFactory,
  NullLogger,
} from '@benzenejs/abstractions';
import { IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import { IMiddlewareApplicationWithResult } from '@benzenejs/abstractions-middleware';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import {
  BenzeneMessageRequest,
  IBenzeneMessageRequest,
  IBenzeneMessageResponse,
} from '@benzenejs/core-messages';
import { asBenzeneResult, BenzeneMessageClientResponse, IBenzeneMessageClient } from '@benzenejs/clients';
import { BenzeneResult } from '@benzenejs/results';
import { InProcessDispatcherRegistry } from './InProcessDispatcherRegistry';
import { InProcessMessagingBuilder } from './InProcessMessagingBuilder';

type Dispatcher = IMiddlewareApplicationWithResult<IBenzeneMessageRequest, IBenzeneMessageResponse>;

/**
 * The standalone {@link IBenzeneMessageClient} for in-process dispatch — the transport-agnostic client
 * surface over a pipeline registered via `addInProcessMessaging(...)`, for the code path that holds a
 * client directly (a `BenzeneMessageClientFactory` mapping, a module handed "a client" without knowing
 * the transport) rather than going through `DefaultBenzeneMessageSender`'s outbound routing table.
 *
 * TS-OWN ADDITION (no .NET counterpart file): .NET's `Benzene.Clients.InProcess` ships only the routed
 * middleware path; this port adds the standalone client so the in-process transport offers the same two
 * entry points every response-bearing transport does (routed `sendAsync` via `useInProcess`, standalone
 * `sendMessageAsync` via this class) — closing the typed-wiring remainder from the archived
 * typed-outbound-responses plan. It is a thin reuse of the existing mechanism, not a second dispatch
 * path: the request is the same `BenzeneMessageRequest` envelope `buildInProcessRequest` produces for
 * the routed path, the dispatch is the same registry-built dispatcher, and the typed result comes from
 * the same `asBenzeneResult<TResponse>` the routed path's `DefaultBenzeneMessageSender` uses — so a
 * failure's RFC 9457 problem document is surfaced as structured errors here exactly as it is there.
 *
 * Mirrors the standalone-client conventions of `GrpcBenzeneMessageClient`/`KafkaBenzeneMessageClient`:
 * response deserialization is structural (`JSON.parse` + a cast — no runtime `TResponse` to validate
 * against), and an unexpected dispatch throw is caught into a `service-unavailable` result rather than
 * escaping (the handler pipeline itself already folds handler failures into the response envelope, so
 * this catch only guards genuine wiring bugs).
 */
export class InProcessBenzeneMessageClient implements IBenzeneMessageClient {
  private readonly dispatcher: Dispatcher;
  private readonly serviceResolverFactory: IServiceResolverFactory;
  private readonly serializer: ISerializer;
  private readonly logger: ILogger;

  constructor(
    dispatcher: Dispatcher,
    serviceResolverFactory: IServiceResolverFactory,
    serializer: ISerializer = new JsonSerializer(),
    logger: ILogger = NullLogger.instance,
  ) {
    this.dispatcher = dispatcher;
    this.serviceResolverFactory = serviceResolverFactory;
    this.serializer = serializer;
    this.logger = logger;
  }

  /**
   * Builds a client for the named pipeline from a resolver whose container ran
   * `addInProcessMessaging(...)` — the shape a `ClientMapping.builder` / DI registration uses. Throws
   * `InProcessPipelineNotFoundException` (from the registry) when nothing registered under `name`.
   */
  static create(
    resolver: IServiceResolver,
    name: string = InProcessMessagingBuilder.DefaultName,
  ): InProcessBenzeneMessageClient {
    return new InProcessBenzeneMessageClient(
      resolver.getService(InProcessDispatcherRegistry).resolve(name),
      resolver.getService(IServiceResolverFactory),
    );
  }

  async sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    try {
      const messageRequest = new BenzeneMessageRequest();
      messageRequest.topic = request.topic;
      messageRequest.headers = { ...request.headers };
      messageRequest.body = this.serializer.serialize(request.message);

      const response = await this.dispatcher.handleAsync(messageRequest, this.serviceResolverFactory);

      return asBenzeneResult<TResponse>(
        new BenzeneMessageClientResponse(
          response.statusCode,
          response.body,
          response.headers,
          response.isSuccessful,
        ),
        this.serializer,
      );
    } catch (ex) {
      this.logger.logError(ex, `Sending message ${request.topic} failed`);
      return BenzeneResult.serviceUnavailable<TResponse>(ex instanceof Error ? ex.message : String(ex));
    }
  }

  dispose(): void {
    // Nothing to release — the dispatcher and resolver factory are owned by the container.
  }
}
