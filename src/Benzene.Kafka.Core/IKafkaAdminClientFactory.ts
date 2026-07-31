/** Port of Benzene.Kafka.Core.IKafkaAdminClientFactory / KafkaAdminClientFactory. */
import { Admin, Kafka } from 'kafkajs';

/**
 * Supplies the kafkajs {@link Admin} the {@link KafkaHealthCheck} uses for its read-only metadata probe,
 * plus the bootstrap servers to report as the broker dependency.
 *
 * PORT DIVERGENCE: C#'s `IKafkaAdminClientFactory` exposes only the reused `AdminClient`; it reads the
 * bootstrap servers from `config.ConsumerConfig.BootstrapServers`. The TypeScript `BenzeneKafkaConfig`
 * deliberately holds no broker/connection settings (the caller builds the `Kafka` client and hands the
 * worker a ready `Consumer` via {@link IKafkaConsumerFactory}), and a kafkajs `Consumer` gives no way
 * back to the `Kafka` instance or an `Admin`. So this seam is what carries both the `Admin` factory and
 * the `bootstrapServers` identity — the caller, who built the `Kafka` client, supplies them here. Like the
 * other transport factories it is passed directly to `useKafka` (not resolved from the container).
 */
export interface IKafkaAdminClientFactory {
  /** The cluster's bootstrap servers, reported as the broker dependency and used as the dedup key. */
  readonly bootstrapServers: string;

  /** Creates a kafkajs `Admin`. The health check connects it, reads metadata, then disconnects it. */
  create(): Admin;
}

/**
 * Default {@link IKafkaAdminClientFactory} over a caller-built kafkajs {@link Kafka} client.
 *
 * PORT DIVERGENCE: C#'s `KafkaAdminClientFactory` lazily builds and reuses one long-lived admin client
 * (Confluent admin construction is expensive). A kafkajs `Admin` is a lifecycle object (`connect` /
 * `disconnect`) that isn't safe to share across concurrent probes, so `create()` returns a fresh `Admin`
 * from the shared `Kafka` client each probe and {@link KafkaHealthCheck} connects/disconnects it — the
 * `Kafka` client (which owns the pooled broker connections) is the thing reused, not the admin.
 */
export class KafkaAdminClientFactory implements IKafkaAdminClientFactory {
  /**
   * @param kafka The caller-built kafkajs client (its broker connections are reused across probes).
   * @param bootstrapServers The cluster's bootstrap servers, reported as the broker dependency.
   */
  constructor(
    private readonly kafka: Kafka,
    readonly bootstrapServers: string,
  ) {}

  create(): Admin {
    return this.kafka.admin();
  }
}
