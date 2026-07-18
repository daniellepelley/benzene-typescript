import { IBenzeneServiceContainer, tryAddScoped } from '@benzene/abstractions';
import {
  IMessageHandlerResultSetter,
  IMediaFormatNegotiator,
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
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
  TransportInfo,
} from '@benzene/core-message-handlers';
import { SqsMessageBodyGetter } from './SqsMessageBodyGetter';
import { SqsMessageContext } from './SqsMessageContext';
import { SqsMessageHeadersGetter } from './SqsMessageHeadersGetter';
import { SqsMessageMessageHandlerResultSetter } from './SqsMessageMessageHandlerResultSetter';
import { SqsMessageTopicGetter } from './SqsMessageTopicGetter';

/**
 * Port of Benzene.Aws.Lambda.Sqs.DependencyInjectionExtensions (C# extension methods -> free
 * functions).
 *
 * Registers the services required to process SQS messages: request mapping, the SQS boundary getters
 * and result setter, media-format negotiation, and a `"sqs"` `ITransportInfo`. Called automatically
 * by `useSqs`.
 *
 * DI-under-erasure notes (same pattern as the ported `addBenzeneMessage`/`addContextItems`): C#
 * closed-generic registrations like `AddScoped<IMessageBodyGetter<SqsMessageContext>, ...>` become
 * factory registrations under each interface's shared `<unknown>` token (the app uses one context
 * type per pipeline, so the erased `<SqsMessageContext>` is closed here). Where C# uses `TryAddScoped`
 * the port uses `tryAddScoped`; where it uses `AddScoped`/`AddSingleton` the port uses the
 * non-`try` factory registrations, so these SQS getters win over the generic `addContextItems`
 * defaults registered later.
 */
export function addSqs(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);

  services.addScopedFactory(
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<SqsMessageContext>(
        new SqsMessageTopicGetter(),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new SqsMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new SqsMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new SqsMessageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<SqsMessageContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo('sqs'));
  return services;
}
