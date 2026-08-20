/** Port of Benzene.RabbitMq.RabbitMqHealthCheck. */
import {
  HealthCheckDependency,
  HealthCheckError,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';
import { IRabbitMqConnectionProvider } from './RabbitMqConnectionProvider';

/**
 * Verifies a RabbitMQ consumer can reach its broker and that the consumed queue exists, with a **passive**
 * queue declare (amqplib `channel.checkQueue`) — the RabbitMQ analogue of the other reachability checks,
 * non-destructive: a passive declare neither creates nor mutates the queue (it returns the queue's
 * message/consumer counts, or a channel-level `404` if the queue is gone). Reported on the **dependency**
 * category (deep `benzene:healthcheck` layer only — a broker being unreachable is shared-fate; see
 * `IDependencyHealthCheck`). A permission failure (AMQP `403 access-refused`) is a **persistent** failure
 * — it surfaces as unhealthy even for the auto-wired dependency check rather than being softened to a
 * Warning, since a missing permission is a deterministic misconfiguration that won't self-heal; the
 * exception message is never included.
 *
 * ADAPTATION: C# bounds the connect + declare with a `CancellationToken`; amqplib's `connect`/
 * `createChannel`/`checkQueue` take no cancellation, so the round-trip is bounded by racing it against a
 * timeout instead (an aborting `AbortSignal` is still handed to the connection provider for parity).
 */
export class RabbitMqHealthCheck implements IHealthCheck {
  /** The default timeout for the connect + passive-declare round-trip, in milliseconds. */
  static readonly defaultTimeoutMs = 5000;

  constructor(
    private readonly connectionProvider: IRabbitMqConnectionProvider,
    private readonly queueName: string,
    private readonly timeoutMs: number = RabbitMqHealthCheck.defaultTimeoutMs,
  ) {}

  get type(): string {
    return 'RabbitMq';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Queue', this.queueName)];

    try {
      await this.withTimeout(async (signal) => {
        const connection = await this.connectionProvider.getConnectionAsync(signal);
        const channel = await connection.createChannel();
        try {
          // Passive declare: read-only existence + reachability, no create/mutate.
          await channel.checkQueue(this.queueName);
        } finally {
          // Close the channel in the same async scope that opened it. amqplib's `createChannel`/
          // `checkQueue` are not abortable, so a timeout in `withTimeout` rejects the *outer* await while
          // this closure is still suspended; closing here (rather than in an outer `finally`) guarantees
          // the channel is released once `createChannel`/`checkQueue` eventually settle, even after the
          // outer timeout already returned a result — otherwise every timed-out probe leaks a channel. A
          // channel-level exception (e.g. 404) has already closed the channel; close best-effort.
          await channel.close().catch(() => undefined);
        }
      });

      return HealthCheckResult.createInstance(true, this.type, { Queue: this.queueName }, dependencies);
    } catch (error) {
      // Expected failures (broker unreachable, queue missing, no permission) are a classified result, not
      // a throw. HealthCheckError applies the shared policy: an authorization failure (401/403) is a
      // persistent Failed, anything else a transient Failed, enriched with the AMQP reply code, never the
      // exception message.
      const { errorCode, statusCode } = rabbitMqErrorDetails(error);
      return HealthCheckError.classify(this.type, error, dependencies, {
        errorCode,
        statusCode,
        data: { Queue: this.queueName },
      });
    }
  }

  /** Races `op` against {@link timeoutMs}, aborting the handed signal on timeout. */
  private withTimeout(op: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`RabbitMq health check timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      op(controller.signal).then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}

/**
 * Extracts the AMQP reply code the shared policy classifies on. amqplib surfaces a channel-level failure
 * as an error carrying a numeric `code` (the 3-digit AMQP reply code): `403` (access-refused) → persistent
 * Failed, `404` (not-found) → transient Failed. A non-AMQP error (raw socket failure, timeout) yields
 * neither, matching C#'s `null`/`null`.
 */
export function rabbitMqErrorDetails(error: unknown): { errorCode?: string; statusCode?: number } {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'number') {
    return { errorCode: String(code), statusCode: code };
  }
  return {};
}
