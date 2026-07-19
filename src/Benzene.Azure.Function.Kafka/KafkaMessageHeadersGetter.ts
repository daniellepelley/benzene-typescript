/** Port of Benzene.Azure.Function.Kafka.KafkaMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { KafkaContext } from './KafkaContext';

/**
 * Extracts headers from a Kafka event. FAITHFUL to the C#: `KafkaRecord` headers aren't mapped, so
 * this always returns an empty dictionary (C# `return new Dictionary<string, string>();` ->
 * `return {};`).
 */
export class KafkaMessageHeadersGetter implements IMessageHeadersGetter<KafkaContext> {
  getHeaders(_context: KafkaContext): Record<string, string> {
    return {};
  }
}
