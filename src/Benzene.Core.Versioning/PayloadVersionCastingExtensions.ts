/** Port of Benzene.Core.Versioning.PayloadVersionCastingExtensions. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import {
  IMediaFormatNegotiator,
  IMessageTopicGetter,
  IMessageVersionGetter,
  IRequestEnricher,
  IRequestMapper,
  IResponsePayloadMapper,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import {
  DefaultResponsePayloadMapper,
  MultiSerializerOptionsRequestMapper,
} from '@benzene/core-message-handlers';
import { CastingRequestMapper } from './Request/CastingRequestMapper';
import { CastingResponsePayloadMapper } from './Response/CastingResponsePayloadMapper';
import { ISchemaCasters } from './Schemas/ISchemaCasters';

/**
 * Wraps the request and response payload mappers for `TContext` with the version-casting decorators, so
 * an incoming older-version payload is upcast into the handler's declared request type and the response
 * is downcast back to the requested version - the handler only ever sees its own (canonical) schema. A
 * topic with no registered casters, or a message that signals no version, is unaffected.
 * Port of Benzene.Core.Versioning.PayloadVersionCastingExtensions (C# extension method -> free function).
 *
 * Call this AFTER the transport's registration (e.g. `addBenzeneMessage` + `addContextItems`), so these
 * `addScopedFactory` overrides win. C# self-registers the framework-default mappers as their own concrete
 * types and resolves them; TypeScript classes have no per-type token, so the defaults are reconstructed
 * here exactly as `addContextItems` does, then wrapped.
 */
export function usePayloadVersionCasting<TContext>(
  services: IBenzeneServiceContainer,
): IBenzeneServiceContainer {
  services.addScopedFactory(
    IRequestMapper,
    (resolver) => {
      const inner = new MultiSerializerOptionsRequestMapper<TContext>(
        resolver.getService(IMediaFormatNegotiator) as unknown as IMediaFormatNegotiator<TContext>,
        resolver,
        resolver.getService(IMessageBodyGetter) as unknown as IMessageBodyGetter<TContext>,
        resolver.getServices(IRequestEnricher) as unknown as IRequestEnricher<TContext>[],
      );
      return new CastingRequestMapper<TContext>(
        inner,
        resolver.getService(IMessageVersionGetter) as unknown as IMessageVersionGetter<TContext>,
        resolver.getService(IMessageTopicGetter) as unknown as IMessageTopicGetter<TContext>,
        resolver.tryGetService(ISchemaCasters),
      ) as unknown as IRequestMapper<unknown>;
    },
  );

  services.addScopedFactory(
    IResponsePayloadMapper,
    (resolver) =>
      new CastingResponsePayloadMapper<TContext>(
        new DefaultResponsePayloadMapper<TContext>(),
        resolver.getService(IMessageVersionGetter) as unknown as IMessageVersionGetter<TContext>,
        resolver.getService(IMessageTopicGetter) as unknown as IMessageTopicGetter<TContext>,
        resolver.tryGetService(ISchemaCasters),
      ) as unknown as IResponsePayloadMapper<unknown>,
  );

  return services;
}
