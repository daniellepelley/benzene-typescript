/**
 * Port of Benzene.Aws.Lambda.S3.DependencyInjectionExtensions (C# extension methods -> free functions).
 */
import { IBenzeneServiceContainer, tryAddScoped } from '@benzene/abstractions';
import {
  IMediaFormatNegotiator,
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  IRequestEnricher,
  IRequestMapper,
  ITransportInfo,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import {
  addMediaFormatNegotiation,
  JsonSerializer,
  MultiSerializerOptionsRequestMapper,
  TransportInfo,
} from '@benzene/core-message-handlers';
import { S3MessageBodyGetter } from './S3MessageBodyGetter';
import { S3MessageHeadersGetter } from './S3MessageHeadersGetter';
import { S3MessageMessageHandlerResultSetter } from './S3MessageMessageHandlerResultSetter';
import { S3MessageTopicGetter } from './S3MessageTopicGetter';
import { S3RecordContext } from './S3RecordContext';

/**
 * Registers the services required to process S3 event notifications: topic/body/header extraction, request
 * mapping, media-format negotiation, and a `"s3"` `ITransportInfo`, so S3 records can be routed to message
 * handlers by their event name. Called automatically by `useS3`.
 *
 * DI-under-erasure notes (same pattern as the ported `addSns`/`addSqs`): C# closed-generic registrations
 * like `AddScoped<IMessageBodyGetter<S3RecordContext>, ...>` become factory registrations under each
 * interface's shared `<unknown>` token (one context type per pipeline, so the erased `<S3RecordContext>` is
 * closed here). Where C# uses `TryAddScoped` the port uses `tryAddScoped`; `AddScoped`/`AddSingleton`
 * become the non-`try` factory registrations, so these S3 getters win over any generic defaults.
 *
 * TOPIC GETTER: matching the C# `AddS3`, the topic getter is registered DIRECTLY (no
 * `PresetTopicMessageTopicGetter`/`PresetTopicHolder` wrapping — that is an SQS/Kinesis concern). S3
 * derives the topic from the record's native event name.
 */
export function addS3(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  services.addScopedFactory(
    IMessageTopicGetter,
    () => new S3MessageTopicGetter() as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new S3MessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new S3MessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new S3MessageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<S3RecordContext>(services);

  services.addScopedFactory(
    IRequestMapper,
    (resolver) =>
      new MultiSerializerOptionsRequestMapper(
        resolver.getService(IMediaFormatNegotiator),
        resolver,
        resolver.getService(IMessageBodyGetter),
        resolver.getServices(IRequestEnricher),
      ) as IRequestMapper<unknown>,
  );

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo('s3'));
  return services;
}
