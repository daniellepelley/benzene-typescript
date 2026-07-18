/**
 * Port of Benzene.Aws.Lambda.DynamoDb.DependencyInjectionExtensions (C# extension methods -> free
 * functions).
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
import { DynamoDbMessageBodyGetter } from './DynamoDbMessageBodyGetter';
import { DynamoDbMessageHeadersGetter } from './DynamoDbMessageHeadersGetter';
import { DynamoDbMessageMessageHandlerResultSetter } from './DynamoDbMessageMessageHandlerResultSetter';
import { DynamoDbMessageTopicGetter } from './DynamoDbMessageTopicGetter';
import { DynamoDbRecordContext } from './DynamoDbRecordContext';

/**
 * Registers the services required to process DynamoDB stream records: request mapping, the DynamoDB
 * boundary getters and result setter, media-format negotiation, and a `"dynamodb"` `ITransportInfo`.
 * Called automatically by `useDynamoDb`.
 *
 * DI-under-erasure notes (same pattern as the ported `addSqs`): C# closed-generic registrations like
 * `AddScoped<IMessageBodyGetter<DynamoDbRecordContext>, ...>` become factory registrations under each
 * interface's shared `<unknown>` token. Where C# uses `TryAddScoped` the port uses `tryAddScoped`;
 * `AddScoped`/`AddSingleton` become the non-`try` factory registrations. As in C# `AddDynamoDb`, the
 * topic getter is registered DIRECTLY (no preset-topic wrapping) — the topic is `"{table}:{eventName}"`,
 * derived from the record itself.
 */
export function addDynamoDb(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  services.addScopedFactory(
    IMessageTopicGetter,
    () => new DynamoDbMessageTopicGetter() as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new DynamoDbMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new DynamoDbMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new DynamoDbMessageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<DynamoDbRecordContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo('dynamodb'));
  return services;
}
