/**
 * Port of Benzene.Aws.Lambda.Kinesis.DependencyInjectionExtensions (adapted — see the ADAPTATION note).
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
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
  TransportInfo,
} from '@benzene/core-message-handlers';
import { KinesisMessageBodyGetter } from './KinesisMessageBodyGetter';
import { KinesisMessageContext } from './KinesisMessageContext';
import { KinesisMessageHeadersGetter } from './KinesisMessageHeadersGetter';
import { KinesisMessageMessageHandlerResultSetter } from './KinesisMessageMessageHandlerResultSetter';
import { KinesisMessageTopicGetter } from './KinesisMessageTopicGetter';

/**
 * Registers the services required to process Kinesis records: request mapping, the Kinesis boundary
 * getters and result setter, media-format negotiation, and a `"kinesis"` `ITransportInfo`. Called
 * automatically by `useKinesis`.
 *
 * ADAPTATION: the C# `AddKinesis` registers ONLY the transport info, because the streaming model consumes
 * the batch directly via `UseStream(...)` rather than routing records to topic handlers. This port instead
 * fans out per record (the streaming engine is not yet available — see `KinesisMessageContext`), so it
 * registers the same getter/result-setter/request-mapper set the SQS adapter does. The topic getter is
 * wrapped in `PresetTopicMessageTopicGetter` (Kinesis records carry no topic — route via
 * `usePresetTopic('<topic>')`). DI-under-erasure follows the ported `addSqs` pattern.
 */
export function addKinesis(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);

  services.addScopedFactory(
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<KinesisMessageContext>(
        new KinesisMessageTopicGetter(),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new KinesisMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new KinesisMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new KinesisMessageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<KinesisMessageContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo('kinesis'));
  return services;
}
