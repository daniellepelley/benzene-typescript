import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import {
  IMediaFormatNegotiator,
  IRequestEnricher,
  IRequestMapper,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyBytesGetter, IMessageBodyGetter } from '@benzene/abstractions-messages';
import { EnrichingRequestMapper } from './EnrichingRequestMapper';
import { RequestMapper } from './RequestMapper';

/**
 * `IRequestMapper<TContext>` that asks the shared `IMediaFormatNegotiator<TContext>` which format
 * applies to the incoming context (falling back to JSON if none match), then maps the body (with
 * enrichment) using that format's serializer.
 * Port of Benzene.Core.MessageHandlers.Request.MultiSerializerOptionsRequestMapper&lt;TContext&gt;.
 *
 * The composed `RequestMapper`/`EnrichingRequestMapper` pair for a given resolved `ISerializer` is a
 * pure function of (serializer, body getter, enrichers) — none of which change for the lifetime of
 * this scoped, per-message instance — so it is built once per distinct serializer and cached. The
 * C# `Dictionary<ISerializer, IRequestMapper>` (keyed by serializer instance) maps to a
 * `Map<ISerializer, IRequestMapper<TContext>>` with the same identity-keyed caching.
 *
 * The optional byte-oriented getter is resolved via `resolver.tryGetService(IMessageBodyBytesGetter)`,
 * the port of C# `serviceResolver.TryGetService<IMessageBodyBytesGetter<TContext>>()`, returning
 * `undefined` when absent.
 */
export class MultiSerializerOptionsRequestMapper<TContext> implements IRequestMapper<TContext> {
  private readonly enrichers: IRequestEnricher<TContext>[];
  private readonly messageBodyBytesGetter: IMessageBodyBytesGetter<TContext> | undefined;
  private readonly mappersBySerializer = new Map<ISerializer, IRequestMapper<TContext>>();

  constructor(
    private readonly mediaFormatNegotiator: IMediaFormatNegotiator<TContext>,
    private readonly serviceResolver: IServiceResolver,
    private readonly messageBodyGetter: IMessageBodyGetter<TContext>,
    enrichers: Iterable<IRequestEnricher<TContext>>,
  ) {
    this.enrichers = Array.from(enrichers);
    this.messageBodyBytesGetter = serviceResolver.tryGetService(
      IMessageBodyBytesGetter,
    ) as IMessageBodyBytesGetter<TContext> | undefined;
  }

  getBody<TRequest>(context: TContext): TRequest | undefined {
    const serializer = this.mediaFormatNegotiator.selectRead(context).getSerializer(this.serviceResolver);

    let mapper = this.mappersBySerializer.get(serializer);
    if (mapper === undefined) {
      mapper = new EnrichingRequestMapper<TContext>(
        new RequestMapper<TContext>(this.messageBodyGetter, serializer, this.messageBodyBytesGetter),
        this.enrichers,
      );
      this.mappersBySerializer.set(serializer, mapper);
    }

    return mapper.getBody<TRequest>(context);
  }
}
