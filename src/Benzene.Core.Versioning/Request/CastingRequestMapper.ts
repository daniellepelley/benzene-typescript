/** Port of Benzene.Core.Versioning.Request.CastingRequestMapper (RequestBodyReader folded in). */
import { Constructor, ServiceIdentifier } from '@benzene/abstractions';
import { IMessageVersionGetter, IRequestMapper } from '@benzene/abstractions-message-handlers';
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ISchemaCasters } from '../Schemas/ISchemaCasters';

/**
 * Decorates the transport's real {@link IRequestMapper}, transparently upcasting an older-version request
 * payload into the handler's declared request type. When no version is signalled, no topic resolves, no
 * target type is known, or no caster is registered for `(topic, version -> targetType)`, it delegates
 * straight through - so a topic that doesn't opt into versioning behaves exactly as before.
 * Port of Benzene.Core.Versioning.Request.CastingRequestMapper&lt;TContext&gt;.
 *
 * Erasure: C# closes `GetBody<TRequest>` over `typeof(TRequest)` and reads the incoming body via
 * `RequestBodyReader` (a compiled per-type delegate). TypeScript erases `TRequest`, so the target type
 * arrives as the optional `targetType` threaded through `IRequestMapper.getBody` from the routed
 * definition, and reading "the incoming version's shape" is just `inner.getBody(context, caster.fromType)`
 * - the body is shape-based JSON, so no per-type reader compilation is needed.
 */
export class CastingRequestMapper<TContext> implements IRequestMapper<TContext> {
  constructor(
    private readonly inner: IRequestMapper<TContext>,
    private readonly versionGetter: IMessageVersionGetter<TContext>,
    private readonly topicGetter: IMessageTopicGetter<TContext>,
    private readonly schemaCasters?: ISchemaCasters,
  ) {}

  getBody<TRequest>(context: TContext, targetType?: ServiceIdentifier<unknown>): TRequest | undefined {
    if (this.schemaCasters === undefined) {
      return this.inner.getBody<TRequest>(context, targetType);
    }

    const version = this.versionGetter.getVersion(context);
    if (version === undefined || version === '') {
      return this.inner.getBody<TRequest>(context, targetType);
    }

    const topic = this.topicGetter.getTopic(context)?.id;
    if (topic === undefined || topic === '') {
      return this.inner.getBody<TRequest>(context, targetType);
    }

    // Without the target type there is nothing to scope the upcast lookup to (C# had it from typeof(T)).
    if (targetType === undefined) {
      return this.inner.getBody<TRequest>(context, targetType);
    }

    const caster = this.schemaCasters.tryGetSchemaCaster(topic, version, targetType as Constructor<unknown>);
    if (caster === undefined) {
      return this.inner.getBody<TRequest>(context, targetType);
    }

    // Deserialize the wire body as the incoming version's shape (still via the inner mapper), then upcast.
    const incoming = this.inner.getBody(context, caster.fromType);
    if (incoming === undefined || incoming === null) {
      return undefined;
    }

    return caster.cast(incoming) as TRequest;
  }
}
