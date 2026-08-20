/** Port of Benzene.Kafka.Core.KafkaHealthCheck. */
import {
  HealthCheckDependency,
  HealthCheckError,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';
import { IKafkaAdminClientFactory } from './IKafkaAdminClientFactory';

/**
 * Verifies a Kafka consumer can reach its cluster and that its subscribed topics exist, with a read-only
 * metadata request (kafkajs `admin.describeCluster` + `admin.fetchTopicMetadata`) — the Kafka analogue of
 * the AWS/Azure reachability checks, non-destructive (it neither consumes, commits, nor produces). Proves
 * the bootstrap brokers are reachable, the credentials authenticate, and each configured topic is present.
 * Reported on the **dependency** category (deep `benzene:healthcheck` layer only — a broker being unreachable is
 * shared-fate; see `IDependencyHealthCheck`). A Kafka authorization failure is a **persistent** failure —
 * it surfaces as unhealthy even for the auto-wired dependency check rather than being softened to a
 * Warning, since a bad credential/ACL is a deterministic misconfiguration that won't self-heal; the
 * exception message is never included.
 *
 * ADAPTATION: C# fetches cluster metadata with no topic argument (to avoid broker-side auto-topic-create)
 * and checks each configured topic. kafkajs `fetchTopicMetadata()` with no `topics` returns all topics —
 * the same cluster-level read — and the check compares the configured topics against it. The port also
 * issues a separate `describeCluster()` for the reported `Brokers` count, so it makes two metadata reads
 * where C#'s single `GetMetadata` yields both — behaviourally equivalent, one extra round-trip. A fresh
 * `Admin` is connected/disconnected per probe (see {@link IKafkaAdminClientFactory}); the round-trip is
 * bounded by a `Promise.race` timeout.
 */
export class KafkaHealthCheck implements IHealthCheck {
  /** The default metadata-request timeout, in milliseconds. */
  static readonly defaultTimeoutMs = 5000;

  private readonly topics: string[];

  constructor(
    private readonly adminClientFactory: IKafkaAdminClientFactory,
    topics: string[],
    private readonly timeoutMs: number = KafkaHealthCheck.defaultTimeoutMs,
  ) {
    this.topics = topics ?? [];
  }

  get type(): string {
    return 'Kafka';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const bootstrapServers = this.adminClientFactory.bootstrapServers;
    const dependencies = [
      new HealthCheckDependency('Broker', bootstrapServers),
      ...this.topics.map((topic) => new HealthCheckDependency('Topic', topic)),
    ];

    const admin = this.adminClientFactory.create();
    try {
      return await this.withTimeout(() => this.probe(admin, bootstrapServers, dependencies));
    } catch (error) {
      // Expected failures (broker unreachable, timed out, not authorized) are a classified result, not a
      // throw. HealthCheckError applies the shared policy: an authorization failure is a persistent
      // Failed, anything else a transient Failed, enriched with the Kafka error type, never the message.
      const { errorCode, statusCode } = kafkaErrorDetails(error);
      return HealthCheckError.classify(this.type, error, dependencies, {
        errorCode,
        statusCode,
        data: { Broker: bootstrapServers },
      });
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  private async probe(
    admin: ReturnType<IKafkaAdminClientFactory['create']>,
    bootstrapServers: string,
    dependencies: HealthCheckDependency[],
  ): Promise<IHealthCheckResult> {
    await admin.connect();
    const cluster = await admin.describeCluster();
    // Cluster-level (no topic argument) so it never triggers broker-side auto-topic-creation.
    const metadata = await admin.fetchTopicMetadata();

    const present = new Set(metadata.topics.map((topic) => topic.name));
    const missing = this.topics.filter((topic) => !present.has(topic));

    const data: Record<string, unknown> = { Broker: bootstrapServers, Brokers: cluster.brokers.length };
    if (missing.length > 0) {
      data.MissingTopics = missing.join(',');
      return HealthCheckResult.createInstance(false, this.type, data, dependencies);
    }

    return HealthCheckResult.createInstance(true, this.type, data, dependencies);
  }

  /** Races `op` against {@link timeoutMs}. */
  private withTimeout<T>(op: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Kafka health check timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
      op().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}

/** kafkajs authorization/auth error types the shared policy must treat as a persistent (403) failure. */
const authorizationErrorTypes = new Set([
  'TOPIC_AUTHORIZATION_FAILED',
  'GROUP_AUTHORIZATION_FAILED',
  'CLUSTER_AUTHORIZATION_FAILED',
  'SASL_AUTHENTICATION_FAILED',
]);

/**
 * Extracts the Kafka error type the shared policy classifies on. kafkajs surfaces a broker failure as an
 * error carrying a `type` string (e.g. `KafkaJSProtocolError.type`); the authorization types map to `403`
 * so the shared policy classifies them as a persistent Failed. A non-protocol error yields neither,
 * matching C#'s `null`/`null`.
 */
export function kafkaErrorDetails(error: unknown): { errorCode?: string; statusCode?: number } {
  const type = (error as { type?: unknown } | null | undefined)?.type;
  if (typeof type === 'string' && type !== '') {
    return { errorCode: type, statusCode: authorizationErrorTypes.has(type) ? 403 : undefined };
  }
  return {};
}
