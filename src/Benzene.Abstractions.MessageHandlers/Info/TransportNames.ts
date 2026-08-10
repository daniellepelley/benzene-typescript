/**
 * Port of Benzene.Abstractions.MessageHandlers.Info.TransportNames (C# `const string` fields → a frozen
 * `as const` object, so every member is a string-literal type).
 *
 * The canonical name for each transport Benzene ships an adapter for — the single source of truth that
 * both `TransportMiddlewarePipeline`'s runtime, per-invocation tag (`ISetCurrentTransport` /
 * `ICurrentTransport`) and each transport package's startup-time `ITransportInfo` DI registration
 * (aggregated by `ITransportsInfo`) use, so the two mechanisms can't silently drift apart into two
 * different names for the same transport. Reference `TransportNames.X` everywhere rather than repeating
 * the string literal, so a name change is a single-point edit.
 */
export const TransportNames = {
  /**
   * The value `ICurrentTransport.name` reports before any transport pipeline has recorded itself — i.e.
   * "no transport resolved yet". Observability decorators skip the transport tag while it still reads
   * this, so a probe/pass-through stage (e.g. an SQS handler declining an SNS event in a multi-transport
   * function) isn't annotated with a sentinel. Kept at the historic `<missing>` value so metric buckets
   * and existing dashboards don't shift.
   */
  Unresolved: '<missing>',

  Http: 'http',
  Asp: 'asp',
  /**
   * TS-only addition (no C# counterpart): the Express host adapter (`@benzene/express`, the analog of
   * `Benzene.AspNet.Core`) reports this transport. Added here so its name is centralized like the rest.
   */
  Express: 'express',
  ApiGateway: 'api-gateway',
  Grpc: 'grpc',
  Benzene: 'benzene',
  /**
   * The in-process transport (`@benzene/clients-in-process`): a topic dispatched straight to a
   * handler registered in the same runtime, never over any wire. Matches .NET's
   * `TransportNames.InProcess` (hyphenated, matching `service-bus`/`queue-storage`).
   */
  InProcess: 'in-process',
  Sqs: 'sqs',
  Sns: 'sns',
  S3: 's3',
  DynamoDb: 'dynamodb',
  Kinesis: 'kinesis',
  EventBridge: 'eventbridge',
  Kafka: 'kafka',
  RabbitMq: 'rabbitmq',
  PubSub: 'pubsub',
  QueueStorage: 'queue-storage',
  ServiceBus: 'service-bus',
  EventHub: 'event-hub',
  EventGrid: 'event-grid',
  BlobStorage: 'blob-storage',
  CosmosDb: 'cosmos-db',
  Timer: 'timer',
} as const;
