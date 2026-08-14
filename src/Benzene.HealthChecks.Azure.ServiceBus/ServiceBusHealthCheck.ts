/** Port of Benzene.HealthChecks.Azure.ServiceBus.ServiceBusHealthCheck. */
import { ServiceBusClient, ServiceBusError, ServiceBusReceiver } from '@azure/service-bus';
import {
  HealthCheckDependency,
  HealthCheckError,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';

/**
 * Verifies an Azure Service Bus entity (a queue, or a topic subscription) is reachable with a
 * read-only `peekMessages` call — the Service Bus analogue of `SqsHealthCheck`, but non-side-effecting:
 * peek neither locks, completes, nor removes a message, and returns an empty array on an empty entity,
 * so a successful round-trip is the connectivity signal without disturbing the queue. Needs only the
 * data-plane `Listen` claim the consumer already holds (no management-plane permission). A short-lived
 * `ServiceBusReceiver` link is opened per probe and closed.
 *
 * PORTING NOTES (all mechanical `@azure/service-bus` renames, same behaviour):
 * - `ServiceBusReceiver.PeekMessageAsync()` (singular) → the JS SDK's `peekMessages(1)` (plural, takes
 *   a max-count); an empty array is still a successful round-trip, exactly as C#'s `null`.
 * - `receiver.DisposeAsync()` → the JS receiver's `close()`.
 * - The JS SDK has no separate `UnauthorizedAccessException`: an authorization denial surfaces as a
 *   `ServiceBusError` with `code === 'UnauthorizedAccess'`. {@link serviceBusErrorDetails} keys off that
 *   code to reproduce C#'s persistent-vs-transient split (see its note).
 */
export class ServiceBusHealthCheck implements IHealthCheck {
  private readonly queueName?: string;
  private readonly topicName?: string;
  private readonly subscriptionName?: string;
  private readonly dependency: HealthCheckDependency;

  /**
   * Initializes a check for a Service Bus queue.
   * @param client The Service Bus client (the caller owns its authentication and lifetime).
   * @param queueName The queue to check.
   */
  constructor(client: ServiceBusClient, queueName: string);
  /**
   * Initializes a check for a topic subscription.
   * @param client The Service Bus client (the caller owns its authentication and lifetime).
   * @param topicName The topic the subscription belongs to.
   * @param subscriptionName The subscription to check.
   */
  constructor(client: ServiceBusClient, topicName: string, subscriptionName: string);
  constructor(
    private readonly client: ServiceBusClient,
    nameOrTopic: string,
    subscriptionName?: string,
  ) {
    if (subscriptionName === undefined) {
      this.queueName = nameOrTopic;
      this.dependency = new HealthCheckDependency('Queue', nameOrTopic);
    } else {
      this.topicName = nameOrTopic;
      this.subscriptionName = subscriptionName;
      this.dependency = new HealthCheckDependency('Subscription', `${nameOrTopic}/${subscriptionName}`);
    }
  }

  get type(): string {
    return 'ServiceBus';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [this.dependency];
    // Create the receiver inside the try (as C# does): createReceiver can throw synchronously (a
    // malformed/empty entity name, an already-closed client), and an IHealthCheck must report an
    // expected failure as a classified result rather than let it escape executeAsync.
    let receiver: ServiceBusReceiver | undefined;

    try {
      receiver =
        this.queueName !== undefined
          ? this.client.createReceiver(this.queueName)
          : this.client.createReceiver(this.topicName!, this.subscriptionName!);

      // Peek is read-only and non-destructive: it neither locks nor removes the message, and returns
      // an empty array on an empty entity — a successful round-trip is the connectivity signal.
      await receiver.peekMessages(1);

      return HealthCheckResult.createInstance(true, this.type, this.buildData(), dependencies);
    } catch (error) {
      // Expected failures (entity missing, no connectivity, no Listen claim) are a classified result,
      // not a throw. HealthCheckError applies the shared policy: an authorization failure is a
      // persistent Failed, anything else a transient Failed, reporting the SDK failure reason, never
      // the error message.
      const { errorCode, statusCode } = serviceBusErrorDetails(error);
      return HealthCheckError.classify(this.type, error, dependencies, {
        errorCode,
        statusCode,
        data: this.buildData(),
      });
    } finally {
      if (receiver !== undefined) {
        // Close best-effort: a broken AMQP link after a failed peek can make `close()` itself reject, and
        // an unguarded rejection here would escape `executeAsync` (a health check throwing instead of
        // returning a classified result) and discard the `classify(...)` result on the failure path.
        // Matches the guarded cleanup in the sibling RabbitMq / Kafka checks.
        await receiver.close().catch(() => undefined);
      }
    }
  }

  private buildData(): Record<string, unknown> {
    const data: Record<string, unknown> = { Entity: this.dependency.name };

    // The fully-qualified namespace host (e.g. myns.servicebus.windows.net) is not a secret — it
    // identifies which bus the check targets, useful in a mesh view. Guarded because a stub client
    // leaves it undefined.
    const ns = this.client.fullyQualifiedNamespace;
    if (ns) {
      data['Namespace'] = ns;
    }

    return data;
  }
}

/**
 * Extracts the non-sensitive error code / HTTP status the shared policy classifies on.
 *
 * Service Bus is AMQP, not HTTP. The JS SDK folds C#'s two exception types into one `ServiceBusError`
 * with a `code`, so — unlike the .NET original, which keys off the CLR exception *type* — the port
 * keys off that code: `'UnauthorizedAccess'` maps to `('Unauthorized', 403)` so the shared policy
 * classifies it as a **persistent** Failed (matching C#'s `UnauthorizedAccessException` handling); any
 * other `ServiceBusError` reports its `code` as the error code with no status (transient Failed,
 * matching C#'s `ServiceBusException.Reason`); a non-`ServiceBusError` yields neither.
 */
export function serviceBusErrorDetails(error: unknown): { errorCode?: string; statusCode?: number } {
  if (error instanceof ServiceBusError) {
    if (error.code === 'UnauthorizedAccess') {
      return { errorCode: 'Unauthorized', statusCode: 403 };
    }

    return { errorCode: error.code };
  }

  return {};
}
