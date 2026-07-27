/** Port of Benzene.Azure.ServiceBus.BenzeneServiceBusWorker. */
import {
  ProcessErrorArgs,
  ServiceBusClient,
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
  ServiceBusReceiverOptions,
  ServiceBusSessionReceiver,
  ServiceBusSessionReceiverOptions,
} from '@azure/service-bus';
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IBenzeneWorker } from '@benzene/abstractions-middleware';
import { BenzeneException } from '@benzene/core';
import { BenzeneServiceBusConfig, withServiceBusConfigDefaults } from './BenzeneServiceBusConfig';
import { IServiceBusClientFactory } from './IServiceBusClientFactory';
import { IServiceBusMessageSettler } from './IServiceBusMessageSettler';
import { ServiceBusConsumerAckMode } from './ServiceBusConsumerAckMode';
import { ServiceBusConsumerApplication } from './ServiceBusConsumerApplication';
import { ServiceBusSettlement } from './ServiceBusSettlement';
import { ServiceBusSettlementDecision } from './ServiceBusSettlementDecision';

/**
 * How long a session slot holds a locked-but-idle session (no new message delivered) before
 * releasing it and accepting the next one, so an empty session can't starve the other slots.
 *
 * BEND — this timer is the session-pump's stand-in for the drain detection .NET's
 * `ServiceBusSessionProcessor` does internally (its `SessionIdleTimeout`). `@azure/service-bus`'s
 * `subscribe` keeps a session locked and never signals "this session is drained", so the pump owns
 * that decision. Not exposed on {@link BenzeneServiceBusConfig} (the .NET Benzene config doesn't
 * expose `SessionIdleTimeout` either); an internal constant keeps config parity with .NET.
 */
const SESSION_IDLE_TIMEOUT_MS = 60_000;

/**
 * Delay between an empty/failed `acceptNextSession` and the next attempt, so a slot can't spin hot
 * when no session is ever available. Interruptible by the stop signal.
 */
const NO_SESSION_BACKOFF_MS = 1_000;

/**
 * A long-running worker that consumes a Service Bus queue or topic subscription and dispatches each
 * received message through the middleware pipeline — for `@benzene/self-host`, not Azure Functions
 * (use `@benzene/azure-function-service-bus` for a Service Bus trigger).
 *
 * PORTING NOTE — the SDK's push model. .NET uses `ServiceBusProcessor` (`ProcessMessageAsync`/
 * `ProcessErrorAsync` events, `StartProcessingAsync`/`StopProcessingAsync`) with settlement on the
 * delivery event args. `@azure/service-bus` has no `ServiceBusProcessor`: a `ServiceBusReceiver`
 * exposes `subscribe({ processMessage, processError }, { maxConcurrentCalls, autoCompleteMessages })`
 * (returning a closeable) and the settle methods live on the receiver itself. `startAsync` creates the
 * receiver and subscribes (returning once running — correct `IHostedService` semantics); `stopAsync`
 * closes the subscription and receiver (draining in-flight handlers) then disposes the client.
 * Receive-side failures surface through `processError`, are logged, and never end the worker.
 *
 * BEND — sessions (the bounded session pump). .NET consumes a session-enabled entity with a
 * `ServiceBusSessionProcessor`, which auto-manages up to `MaxConcurrentSessions` locked sessions and
 * delivers each session's messages FIFO. The JS SDK has **no session processor** — only the
 * one-session-at-a-time `client.acceptNextSession(entity, options)` primitive, which locks a single
 * session and returns a `ServiceBusSessionReceiver` (itself a `ServiceBusReceiver`, so it has the
 * same `subscribe` and the same settle methods). The .NET session-processor behaviour is recreated
 * faithfully in spirit over that primitive: {@link startAsync} launches `maxConcurrentSessions`
 * concurrent "session slots"; each slot loops `acceptNextSession` → `subscribe` (FIFO within the
 * session via `maxConcurrentCalls = maxConcurrentCallsPerSession`, default 1) → on drain/error/idle,
 * close the session receiver and accept the next session. Settlement is IDENTICAL to the non-session
 * path — the same {@link settleAsync}/{@link ServiceBusConsumerAckMode}/override logic over an
 * {@link IServiceBusMessageSettler} built on the session receiver (a session receiver has the same
 * settle methods). `acceptNextSession` timing out / rejecting with no session available (a
 * `ServiceBusError`, e.g. code `"SessionCannotBeLocked"`) is a normal "retry" case, not a fatal
 * error — the slot backs off ({@link NO_SESSION_BACKOFF_MS}) and tries again; an unexpected error is
 * logged and the slot keeps running rather than dying. See the README "Porting conventions" note.
 */
export class BenzeneServiceBusWorker implements IBenzeneWorker {
  private readonly config: BenzeneServiceBusConfig;
  private client: ServiceBusClient | undefined;
  private receiver: ServiceBusReceiver | undefined;
  private subscription: { close(): Promise<void> } | undefined;

  // Session-pump state (only used when `sessionsEnabled`).
  private stopping = false;
  private sessionsController: AbortController | undefined;
  private sessionPumps: Promise<void>[] = [];
  private readonly openSessionReceivers = new Set<ServiceBusSessionReceiver>();

  constructor(
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly application: ServiceBusConsumerApplication,
    config: BenzeneServiceBusConfig,
    private readonly clientFactory: IServiceBusClientFactory,
  ) {
    this.config = withServiceBusConfigDefaults(config);
  }

  /**
   * Validates the configuration, creates the receiver (or, when `sessionsEnabled`, starts the session
   * pump), and returns once running — it does not block until shutdown. Use `stopAsync` to stop
   * consuming and wait for in-flight messages to finish.
   *
   * @throws {BenzeneException} The configuration doesn't identify exactly one entity.
   */
  async startAsync(cancellationToken?: AbortSignal): Promise<void> {
    this.validate();

    this.client = this.clientFactory.create();

    if (this.config.sessionsEnabled) {
      this.startSessionPump(cancellationToken);
      return;
    }

    const receiverOptions: ServiceBusReceiverOptions = { receiveMode: 'peekLock' };
    if (this.config.maxAutoLockRenewalDurationInMs !== undefined) {
      receiverOptions.maxAutoLockRenewalDurationInMs = this.config.maxAutoLockRenewalDurationInMs;
    }

    this.receiver =
      this.config.queueName !== undefined && this.config.queueName !== ''
        ? this.client.createReceiver(this.config.queueName, receiverOptions)
        : this.client.createReceiver(this.config.topicName!, this.config.subscriptionName!, receiverOptions);

    const autoComplete = this.config.ackMode === ServiceBusConsumerAckMode.AutoComplete;
    this.subscription = this.receiver.subscribe(
      {
        processMessage: (message) => this.handleMessageAsync(this.receiver!, message),
        processError: (args) => this.onProcessErrorAsync(args),
      },
      {
        autoCompleteMessages: autoComplete,
        maxConcurrentCalls: this.config.maxConcurrentCalls,
        ...(cancellationToken !== undefined ? { abortSignal: cancellationToken } : {}),
      },
    );

    return Promise.resolve();
  }

  /**
   * Stops consuming — closing the subscription and receiver (or signalling the session pump to stop
   * and closing any open session receivers), which waits for in-flight handlers to finish — then
   * disposes the client.
   */
  async stopAsync(_cancellationToken?: AbortSignal): Promise<void> {
    // Signal the session pump to stop and unblock any in-flight `acceptNextSession`/backoff.
    this.stopping = true;
    this.sessionsController?.abort();

    if (this.subscription !== undefined) {
      await this.subscription.close();
      this.subscription = undefined;
    }
    if (this.receiver !== undefined) {
      await this.receiver.close();
      this.receiver = undefined;
    }

    // Close any session receivers currently held by a slot, then wait for the slot loops to exit.
    for (const sessionReceiver of [...this.openSessionReceivers]) {
      await this.closeQuietly(sessionReceiver);
    }
    await Promise.all(this.sessionPumps);
    this.sessionPumps = [];
    this.sessionsController = undefined;

    if (this.client !== undefined) {
      await this.client.close();
      this.client = undefined;
    }
  }

  /**
   * Launches `maxConcurrentSessions` session-slot loops and returns. Each slot runs independently; a
   * slot never rejects (all failures are caught and retried), so the returned promises settle only on
   * a graceful stop.
   */
  private startSessionPump(cancellationToken?: AbortSignal): void {
    this.stopping = false;
    const controller = new AbortController();
    this.sessionsController = controller;

    // Link the startup cancellation token: cancelling startup also stops the pump.
    if (cancellationToken !== undefined) {
      if (cancellationToken.aborted) {
        controller.abort();
      } else {
        cancellationToken.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    const signal = controller.signal;
    for (let slot = 0; slot < this.config.maxConcurrentSessions!; slot++) {
      this.sessionPumps.push(this.runSessionSlot(signal));
    }
  }

  /**
   * One session slot: accept a session, drive it to drain/error/idle, close it, repeat — until the
   * stop signal fires. Wrapped so it can never reject (an unexpected error is logged, backed off, and
   * retried), matching the .NET session processor never letting a receive-side fault end the worker.
   */
  private async runSessionSlot(signal: AbortSignal): Promise<void> {
    while (!this.stopping) {
      let sessionReceiver: ServiceBusSessionReceiver;
      try {
        sessionReceiver = await this.acceptNextSession(signal);
      } catch (error) {
        if (this.stopping || signal.aborted) {
          break;
        }
        if (!this.isNoSessionAvailable(error)) {
          // Not the expected "no session right now" — log, but keep the slot alive.
          this.logError(error, 'Accepting the next Service Bus session failed');
        }
        // Either way: back off (so we can't spin hot) and try again.
        await this.delay(NO_SESSION_BACKOFF_MS, signal);
        continue;
      }

      this.openSessionReceivers.add(sessionReceiver);
      try {
        await this.runSession(sessionReceiver, signal);
      } catch (error) {
        this.logError(error, `Consuming Service Bus session ${sessionReceiver.sessionId} failed`);
      } finally {
        this.openSessionReceivers.delete(sessionReceiver);
        await this.closeQuietly(sessionReceiver);
      }
    }
  }

  /**
   * Subscribes to one locked session and resolves when it should be released: an idle timeout with no
   * new message (drain), a `processError`, or the stop signal. Messages are settled through the SAME
   * settler/ack-mode/override logic as the non-session path.
   */
  private runSession(sessionReceiver: ServiceBusSessionReceiver, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      let finished = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
        signal.removeEventListener('abort', onAbort);
        void subscription.close();
      };
      const finish = (): void => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        resolve();
      };
      const resetIdle = (): void => {
        if (finished) {
          return;
        }
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(finish, SESSION_IDLE_TIMEOUT_MS);
      };
      const onAbort = (): void => finish();

      if (signal.aborted) {
        // Already stopping — don't even subscribe; resolve so the slot can exit.
        resolve();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      const autoComplete = this.config.ackMode === ServiceBusConsumerAckMode.AutoComplete;
      const subscription = sessionReceiver.subscribe(
        {
          processMessage: async (message) => {
            resetIdle();
            try {
              await this.handleMessageAsync(sessionReceiver, message);
            } finally {
              resetIdle();
            }
          },
          // A session-scoped error releases the session so the slot can accept the next one.
          processError: async (args) => {
            await this.onProcessErrorAsync(args);
            finish();
          },
        },
        {
          autoCompleteMessages: autoComplete,
          maxConcurrentCalls: this.config.maxConcurrentCallsPerSession,
        },
      );

      resetIdle();
    });
  }

  private acceptNextSession(signal: AbortSignal): Promise<ServiceBusSessionReceiver> {
    const options: ServiceBusSessionReceiverOptions = { receiveMode: 'peekLock', abortSignal: signal };
    if (this.config.maxAutoLockRenewalDurationInMs !== undefined) {
      options.maxAutoLockRenewalDurationInMs = this.config.maxAutoLockRenewalDurationInMs;
    }
    return this.config.queueName !== undefined && this.config.queueName !== ''
      ? this.client!.acceptNextSession(this.config.queueName, options)
      : this.client!.acceptNextSession(this.config.topicName!, this.config.subscriptionName!, options);
  }

  /**
   * Whether an `acceptNextSession` rejection just means "no session available right now" (retry),
   * rather than a genuine fault. The JS SDK raises a `ServiceBusError` — code `"SessionCannotBeLocked"`
   * when a session can't be locked, or a service/operation timeout when none turned up in time.
   * Matched structurally (by `code`) so a fake can drive it without constructing the SDK error type.
   */
  private isNoSessionAvailable(error: unknown): boolean {
    const code = (error as { code?: unknown } | null | undefined)?.code;
    return (
      code === 'SessionCannotBeLocked' ||
      code === 'ServiceTimeout' ||
      code === 'OperationTimeoutError'
    );
  }

  private async handleMessageAsync(
    receiver: ServiceBusReceiver,
    message: ServiceBusReceivedMessage,
  ): Promise<void> {
    if (this.config.ackMode === ServiceBusConsumerAckMode.AutoComplete) {
      // The receiver settles from whether this handler throws: complete on return, abandon on throw
      // (autoCompleteMessages is on). A non-exception failure result still completes.
      await this.application.handleAsync(message, this.serviceResolverFactory);
      return;
    }

    const settler = this.settlerFor(receiver, message);
    try {
      const decision = await this.application.handleAsync(message, this.serviceResolverFactory);
      await BenzeneServiceBusWorker.settleAsync(settler, decision);
    } catch (error) {
      // The rethrow surfaces the error to processError, but that only has the entity/error-source —
      // not which message failed. Log here with the message id so a failure is diagnosable to a
      // specific message, matching the other workers (SQS/Kafka).
      this.logError(error, `Processing Service Bus message ${message.messageId} failed`);
      await settler.abandonMessageAsync();
      throw error;
    }
  }

  private static async settleAsync(
    settler: IServiceBusMessageSettler,
    decision: ServiceBusSettlementDecision,
  ): Promise<void> {
    // An explicit settlement the handler requested wins; otherwise fall back to the outcome-based
    // default (unsuccessful/unset result → abandon, else complete).
    const settlement = decision.settlement?.override;
    if (settlement !== undefined) {
      switch (settlement) {
        case ServiceBusSettlement.Complete:
          await settler.completeMessageAsync();
          return;
        case ServiceBusSettlement.Abandon:
          await settler.abandonMessageAsync();
          return;
        case ServiceBusSettlement.DeadLetter:
          await settler.deadLetterMessageAsync(
            decision.settlement!.deadLetterReason,
            decision.settlement!.deadLetterDescription,
          );
          return;
        case ServiceBusSettlement.Defer:
          await settler.deferMessageAsync();
          return;
      }
    }

    // Abandon on a failure OR an unset result (a pipeline that short-circuited without setting one),
    // completing only on a genuine success — matching the SQS reference's "unset errs toward
    // redelivery, never toward silent loss".
    if (decision.messageResult?.isSuccessful !== true) {
      await settler.abandonMessageAsync();
    } else {
      await settler.completeMessageAsync();
    }
  }

  /**
   * Builds the settle seam over a receiver + message. The same shape serves both the non-session
   * `ServiceBusReceiver` and a `ServiceBusSessionReceiver` (which extends it and has the same settle
   * methods), so sessions differ only in HOW messages are received, not how they're settled.
   */
  private settlerFor(
    receiver: ServiceBusReceiver,
    message: ServiceBusReceivedMessage,
  ): IServiceBusMessageSettler {
    return {
      message,
      completeMessageAsync: () => receiver.completeMessage(message),
      abandonMessageAsync: () => receiver.abandonMessage(message),
      deadLetterMessageAsync: (reason, description) =>
        reason !== undefined || description !== undefined
          ? receiver.deadLetterMessage(message, {
              deadLetterReason: reason ?? '',
              deadLetterErrorDescription: description ?? '',
            })
          : receiver.deadLetterMessage(message),
      deferMessageAsync: () => receiver.deferMessage(message),
    };
  }

  private onProcessErrorAsync(args: ProcessErrorArgs): Promise<void> {
    this.logError(
      args.error,
      `Service Bus processing for ${args.entityPath} failed during ${args.errorSource}`,
    );
    return Promise.resolve();
  }

  /** Logs an error through the worker's `ILoggerFactory`/`NullLogger` scope, matching the C# pattern. */
  private logError(error: unknown, messageText: string): void {
    const loggingScope = this.serviceResolverFactory.createScope();
    try {
      const logger =
        loggingScope.tryGetService(ILoggerFactory)?.createLogger('BenzeneServiceBusWorker') ??
        NullLogger.instance;
      logger.logError(error, messageText);
    } finally {
      loggingScope.dispose();
    }
  }

  /** Closes a session receiver, swallowing errors (it may already be closed by `stopAsync`). */
  private async closeQuietly(sessionReceiver: ServiceBusSessionReceiver): Promise<void> {
    try {
      await sessionReceiver.close();
    } catch (error) {
      this.logError(error, `Closing Service Bus session ${sessionReceiver.sessionId} failed`);
    }
  }

  /** A stop-signal-interruptible delay, so a backing-off slot unblocks immediately on `stopAsync`. */
  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private validate(): void {
    const hasQueue = this.config.queueName !== undefined && this.config.queueName !== '';
    const hasSubscription =
      this.config.topicName !== undefined &&
      this.config.topicName !== '' &&
      this.config.subscriptionName !== undefined &&
      this.config.subscriptionName !== '';

    if (hasQueue === hasSubscription) {
      throw new BenzeneException(
        'BenzeneServiceBusConfig must identify exactly one entity: set either queueName, or both ' +
          'topicName and subscriptionName.',
      );
    }
  }
}
