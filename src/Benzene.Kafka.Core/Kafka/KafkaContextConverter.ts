/** Port of Benzene.Kafka.Core.Kafka.KafkaContextConverter&lt;T&gt;. */
import { ISerializer, VoidResult } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { IContextConverter } from '@benzene/abstractions-middleware';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { Message } from 'kafkajs';
import { isKafkaMessagePersisted, KafkaSendMessageContext } from './KafkaSendMessageContext';

/**
 * Converts a Benzene outbound client request (`IBenzeneClientContext<T, VoidResult>`) into a
 * {@link KafkaSendMessageContext}, and maps the produce outcome back to a Benzene status. Used by
 * {@link KafkaBenzeneMessageClient} and by the `useKafka` pipeline helper.
 */
export class KafkaContextConverter<T>
  implements IContextConverter<IBenzeneClientContext<T, VoidResult>, KafkaSendMessageContext>
{
  private readonly serializer: ISerializer;
  private readonly keyHeader: string | undefined;

  /**
   * @param serializer The serializer used to serialize the outgoing message (defaults to `JsonSerializer`).
   * @param keyHeader The request header whose value becomes the Kafka message key (`hash(key)` → partition,
   * so events sharing a key land on the same partition and stay ordered there). `undefined` (the default)
   * sends a keyless message (round-robin partitioning, no per-key ordering).
   */
  constructor(serializer?: ISerializer, keyHeader?: string) {
    this.serializer = serializer ?? new JsonSerializer();
    this.keyHeader = keyHeader;
  }

  createRequestAsync(contextIn: IBenzeneClientContext<T, VoidResult>): Promise<KafkaSendMessageContext> {
    // Forward the request headers onto the produced message. UTF-8 encode each value; a null/undefined
    // value coalesces to empty (matching the inbound getters' null->empty convention) rather than failing
    // the produce.
    const headers: Record<string, Buffer> = {};
    for (const [key, value] of Object.entries(contextIn.request.headers)) {
      headers[key] = Buffer.from(value ?? '', 'utf8');
    }

    let key: string | null = null;
    if (this.keyHeader !== undefined) {
      key = contextIn.request.headers[this.keyHeader] ?? null;
    }

    const message: Message = {
      key,
      value: this.serializer.serialize(contextIn.request.message),
      headers,
    };

    return Promise.resolve(new KafkaSendMessageContext(contextIn.request.topic, message));
  }

  mapResponseAsync(
    contextIn: IBenzeneClientContext<T, VoidResult>,
    contextOut: KafkaSendMessageContext,
  ): Promise<void> {
    contextIn.response = isKafkaMessagePersisted(contextOut.response)
      ? BenzeneResult.accepted<VoidResult>()
      : BenzeneResult.serviceUnavailable<VoidResult>('Kafka message was not persisted');
    return Promise.resolve();
  }
}
