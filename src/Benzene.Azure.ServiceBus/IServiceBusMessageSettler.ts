/** Port of Benzene.Azure.ServiceBus.IServiceBusMessageSettler. */
import { ServiceBusReceivedMessage } from '@azure/service-bus';

/**
 * Abstracts the settle operations {@link BenzeneServiceBusWorker} needs for one received message.
 *
 * PORTING NOTE: .NET abstracts over the SDK's `ProcessMessageEventArgs` / `ProcessSessionMessageEventArgs`
 * (settlement lives on the delivery event args). `@azure/service-bus` instead exposes settlement on the
 * `ServiceBusReceiver` (`completeMessage`/`abandonMessage`/`deadLetterMessage`/`deferMessage`), which the
 * session receiver also extends, so a single implementation over `receiver` + `message` suffices — but
 * the seam is kept (matching the .NET shape) so the worker settles a message the same way regardless of
 * receiver kind, and tests get a trivial mock point.
 */
export interface IServiceBusMessageSettler {
  /** The received message being settled. */
  readonly message: ServiceBusReceivedMessage;

  /** Completes the message. */
  completeMessageAsync(): Promise<void>;

  /** Abandons the message for redelivery. */
  abandonMessageAsync(): Promise<void>;

  /** Dead-letters the message with the given reason/description. */
  deadLetterMessageAsync(reason: string | undefined, description: string | undefined): Promise<void>;

  /** Defers the message. */
  deferMessageAsync(): Promise<void>;
}
