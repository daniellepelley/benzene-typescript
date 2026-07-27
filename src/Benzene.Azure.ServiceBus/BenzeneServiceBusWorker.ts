/** Port of Benzene.Azure.ServiceBus.BenzeneServiceBusWorker. */
import {
  ProcessErrorArgs,
  ServiceBusClient,
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
  ServiceBusReceiverOptions,
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
 * DIVERGENCE — sessions. The JS SDK has no session *processor* (only one-session-at-a-time
 * `acceptSession`/`acceptNextSession`), so `sessionsEnabled` is not yet supported and `startAsync`
 * throws for it (see {@link BenzeneServiceBusConfig.sessionsEnabled}).
 */
export class BenzeneServiceBusWorker implements IBenzeneWorker {
  private readonly config: BenzeneServiceBusConfig;
  private client: ServiceBusClient | undefined;
  private receiver: ServiceBusReceiver | undefined;
  private subscription: { close(): Promise<void> } | undefined;

  constructor(
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly application: ServiceBusConsumerApplication,
    config: BenzeneServiceBusConfig,
    private readonly clientFactory: IServiceBusClientFactory,
  ) {
    this.config = withServiceBusConfigDefaults(config);
  }

  /**
   * Validates the configuration, creates the receiver, and subscribes. Returns once the receiver is
   * running — it does not block until shutdown. Use `stopAsync` to stop consuming and wait for
   * in-flight messages to finish.
   *
   * @throws {BenzeneException} The configuration doesn't identify exactly one entity, or sessions are
   *   enabled (not yet supported in the TypeScript port).
   */
  async startAsync(cancellationToken?: AbortSignal): Promise<void> {
    this.validate();

    if (this.config.sessionsEnabled) {
      throw new BenzeneException(
        'Session-enabled Service Bus consumption is not yet supported in the TypeScript port ' +
          '(@azure/service-bus has no session processor). See the README roadmap.',
      );
    }

    this.client = this.clientFactory.create();

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
        processMessage: (message) => this.handleMessageAsync(message),
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
   * Stops consuming — closing the subscription and receiver (which waits for in-flight handlers to
   * finish) — then disposes the client.
   */
  async stopAsync(_cancellationToken?: AbortSignal): Promise<void> {
    if (this.subscription !== undefined) {
      await this.subscription.close();
      this.subscription = undefined;
    }
    if (this.receiver !== undefined) {
      await this.receiver.close();
      this.receiver = undefined;
    }
    if (this.client !== undefined) {
      await this.client.close();
      this.client = undefined;
    }
  }

  private async handleMessageAsync(message: ServiceBusReceivedMessage): Promise<void> {
    if (this.config.ackMode === ServiceBusConsumerAckMode.AutoComplete) {
      // The receiver settles from whether this handler throws: complete on return, abandon on throw
      // (autoCompleteMessages is on). A non-exception failure result still completes.
      await this.application.handleAsync(message, this.serviceResolverFactory);
      return;
    }

    const settler = this.settlerFor(message);
    try {
      const decision = await this.application.handleAsync(message, this.serviceResolverFactory);
      await BenzeneServiceBusWorker.settleAsync(settler, decision);
    } catch (error) {
      // The rethrow surfaces the error to processError, but that only has the entity/error-source —
      // not which message failed. Log here with the message id so a failure is diagnosable to a
      // specific message, matching the other workers (SQS/Kafka).
      const loggingScope = this.serviceResolverFactory.createScope();
      try {
        const logger =
          loggingScope.tryGetService(ILoggerFactory)?.createLogger('BenzeneServiceBusWorker') ??
          NullLogger.instance;
        logger.logError(error, `Processing Service Bus message ${message.messageId} failed`);
      } finally {
        loggingScope.dispose();
      }

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

  private settlerFor(message: ServiceBusReceivedMessage): IServiceBusMessageSettler {
    const receiver = this.receiver!;
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
    const loggingScope = this.serviceResolverFactory.createScope();
    try {
      const logger =
        loggingScope.tryGetService(ILoggerFactory)?.createLogger('BenzeneServiceBusWorker') ??
        NullLogger.instance;
      logger.logError(
        args.error,
        `Service Bus processing for ${args.entityPath} failed during ${args.errorSource}`,
      );
    } finally {
      loggingScope.dispose();
    }
    return Promise.resolve();
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
