import { IBenzeneServiceContainer, tryAddScoped } from '@benzenejs/abstractions';
import {
  IMediaFormatNegotiator,
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  IRequestEnricher,
  IRequestMapper,
  ITransportInfo,
  TransportNames,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import {
  addHeaderMessageVersionGetter,
  addMediaFormatNegotiation,
  JsonSerializer,
  MultiSerializerOptionsRequestMapper,
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
  TransportInfo,
} from '@benzenejs/core-message-handlers';
import { SqsConsumerMessageBodyGetter } from './Consumer/SqsConsumerMessageBodyGetter';
import { SqsConsumerMessageContext } from './Consumer/SqsConsumerMessageContext';
import { SqsConsumerMessageHandlerResultSetter } from './Consumer/SqsConsumerMessageHandlerResultSetter';
import { SqsConsumerMessageHeadersGetter } from './Consumer/SqsConsumerMessageHeadersGetter';
import { SqsConsumerMessageTopicGetter } from './Consumer/SqsConsumerMessageTopicGetter';

/**
 * Port of Benzene.Aws.Sqs.DependencyInjectionExtensions (C# extension methods -> free functions).
 *
 * Registers the services required to poll and process SQS messages with the standalone (non-Lambda)
 * consumer: request mapping, the SQS boundary getters and result setter, media-format negotiation, and
 * a `"sqs"` `ITransportInfo`. Called automatically by `useSqs`.
 *
 * DIVERGENCE from C#: the C# `AddSqsConsumer` also registers `AddScoped<ISqsClientFactory,
 * SqsClientFactory>`, because .NET resolves the client factory (and its injected `IAmazonSQS`) from the
 * container. In this port the `ISqsClientFactory` is supplied directly to `useSqs` (matching .NET's
 * `UseSqs` signature) and handed straight to the `SqsConsumer`, and the aws-sdk v3 `SQSClient` it wraps
 * has no container registration, so there is nothing container-resolvable to register here — the factory
 * is not registered in DI. Everything else mirrors the C# registration set (including the header
 * message-version getter, which the Lambda `addSqs` port omits).
 */
export function addSqsConsumer(
  services: IBenzeneServiceContainer,
  topicAttributeKey: string = SqsConsumerMessageTopicGetter.DefaultTopicAttribute,
): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);

  services.addScopedFactory(
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<SqsConsumerMessageContext>(
        new SqsConsumerMessageTopicGetter(topicAttributeKey),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<SqsConsumerMessageContext>(services);
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new SqsConsumerMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new SqsConsumerMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new SqsConsumerMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<SqsConsumerMessageContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.Sqs));
  return services;
}
