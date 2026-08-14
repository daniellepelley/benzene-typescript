# Handling SQS Message Failures

Report per-message failures back to SQS so only the messages that actually failed are redelivered, retry
transient errors in-process before that, and let permanently-failing messages fall through to a
dead-letter queue.

## Problem Statement

You're processing SQS messages through a Benzene Lambda function and need to:

- Retry a message a few times in-process when a downstream dependency is flaky, without retrying the
  whole batch.
- Make sure only the messages that genuinely failed are redelivered by SQS — not every message in the
  batch.
- Let messages that fail permanently fall through to a dead-letter queue (DLQ) instead of retrying
  forever.

This cookbook covers what Benzene does for you (partial-batch-failure reporting, in-process retry
middleware) and where Benzene's responsibility ends — DLQ and event-source-mapping configuration is AWS
infrastructure, not something the TypeScript port generates or wires up.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene Lambda function using `@benzenejs/aws-lambda-sqs` — see
  [AWS Lambda Setup](../getting-started-aws.md).
- The SQS event source mapping configured with `ReportBatchItemFailures` (see
  [Troubleshooting](#troubleshooting) — without this, everything below is silently ignored by AWS).
- An SQS queue with a redrive policy pointing at a dead-letter queue, if you want permanently-failed
  messages to end up in a DLQ.

## Installation

```bash
npm install @benzenejs/aws-lambda @benzenejs/resilience
# for the Testing section:
npm install --save-dev @benzenejs/aws-lambda-testing
```

## How Benzene reports partial batch failures

This is the mechanism the rest of the cookbook builds on, so it's worth understanding exactly what
`@benzenejs/aws-lambda-sqs` does before writing any handler code.

`SqsLambdaHandler` routes an incoming `SQSEvent` to `SqsApplication`, which is the class that actually
implements partial batch failure reporting. For every record in the batch it runs your middleware
pipeline in its own service scope, and it decides whether that record failed in exactly two ways
(from `SqsApplication.handleAsync`):

```ts
try {
  const scope = serviceResolverFactory.createScope();
  try {
    const setCurrentTransport = scope.getService(ISetCurrentTransport);
    setCurrentTransport.setTransport(TransportNames.Sqs);
    await this.pipeline.handleAsync(context, scope);
  } finally {
    scope.dispose();
  }

  // Only an explicit success is acked. A failure result (isSuccessful === false) OR an unset
  // outcome (undefined — e.g. an unroutable message no handler matched) is reported as a failure,
  // so SQS redrives it rather than silently deleting it.
  if (context.isSuccessful === false) {
    batchItemFailures.push({ itemIdentifier: context.sqsMessage.messageId });
  }
} catch (ex) {
  // ...logs the exception via ILoggerFactory...
  batchItemFailures.push({ itemIdentifier: context.sqsMessage.messageId });
}
```

Two ways a message ends up in `batchItemFailures`:

1. **Your handler returns a failure result and no exception is thrown.**
   `SqsMessageMessageHandlerResultSetter` records whether your handler's result was successful on
   `SqsMessageContext.isSuccessful` after the pipeline runs. Any `BenzeneResult` factory built from an
   error list (`serviceUnavailable`, `badRequest`, `validationError`, `notFound`, …) is unsuccessful;
   `ok`, `accepted`, `created`, … are successful. A record whose `isSuccessful` stays `undefined` — e.g.
   an unroutable message whose `topic` attribute matched no handler, so the setter never ran — is **also**
   treated as a failure, so it's redriven rather than silently deleted.
2. **The pipeline throws.** `SqsApplication` catches the exception, logs it via a logger created from
   `ILoggerFactory` (falling back to `NullLogger`), and reports the same message ID as failed.

Either way, only the specific `messageId`s that failed go into the returned
`SQSBatchResponse.batchItemFailures` — the records that succeeded are never reported, so **AWS will not
redeliver them**. This is what makes it a *partial* batch failure: a 10-message batch where 1 message
fails only causes that 1 message to become visible again on the queue.

This is native AWS Lambda SQS event source mapping behavior (`ReportBatchItemFailures` /
`FunctionResponseTypes`); Benzene's contribution is populating the response correctly per-record so you
get it without writing the batch-reconciliation logic yourself.

### Opting into whole-batch failure instead

Partial-batch-failure reporting is the default and the AWS best practice, but it isn't always what you
want — e.g. when messages in a batch aren't independent of each other, or when you haven't configured
`ReportBatchItemFailures` on the event source mapping and would rather Benzene fail loudly than have AWS
silently ignore the partial response. `useSqs` takes an optional `configure` callback for the
`SqsOptions`:

```ts
import { useSqs, SqsBatchFailureMode, useMessageHandlers } from '@benzenejs/aws-lambda';

useSqs(
  app,
  (sqs) => useMessageHandlers(sqs, CapturePaymentHandler),
  (options) => {
    options.batchFailureMode = SqsBatchFailureMode.FailWholeBatch;
  },
);
```

With `SqsBatchFailureMode.FailWholeBatch`, every message in the batch still runs (nothing is skipped or
cancelled early), but if *any* message failed, `SqsApplication` throws an `SqsBatchProcessingException`
(listing the failed message IDs) instead of returning a partial `SQSBatchResponse`. Because the Lambda
invocation itself fails, SQS retries/redrives **every** message in the batch — including the ones that
actually succeeded. The default (`SqsBatchFailureMode.PartialBatchFailure`) reproduces the per-record
behavior above; this is purely opt-in.

## Step-by-Step Implementation

### 1. Write a handler that can fail

Message handlers processing SQS records look like any other Benzene message handler — `@message('topic')`
plus `IMessageHandler<TRequest, TResponse>`. Whether the handler throws or returns a failure result, both
are picked up by `SqsApplication` as shown above.

```ts
import { IBenzeneResultOf, IMessageHandler, message, BenzeneResult } from '@benzenejs/aws-lambda';
import { IPaymentGateway, PaymentGatewayUnavailableError } from './PaymentGateway.js';

export class OrderPaymentMessage {
  orderId?: string;
  amount?: number;
}

export class PaymentReceipt {
  captureId?: string;
}

@message('order:payment-capture', {
  requestType: OrderPaymentMessage,
  responseType: PaymentReceipt,
})
export class CapturePaymentHandler implements IMessageHandler<OrderPaymentMessage, PaymentReceipt> {
  static readonly inject = [IPaymentGateway] as const;

  constructor(private readonly paymentGateway: IPaymentGateway) {}

  async handleAsync(request: OrderPaymentMessage): Promise<IBenzeneResultOf<PaymentReceipt>> {
    try {
      const captureId = await this.paymentGateway.captureAsync(request.orderId!, request.amount!);
      const receipt = new PaymentReceipt();
      receipt.captureId = captureId;
      return BenzeneResult.ok(receipt);
    } catch (error) {
      if (error instanceof PaymentGatewayUnavailableError) {
        // A transient dependency failure: report it as a failed result rather than letting the
        // exception propagate, so it isn't logged as an unhandled pipeline exception every attempt.
        return BenzeneResult.serviceUnavailable<PaymentReceipt>('Payment gateway unavailable');
      }
      // Any other error is left to propagate — SqsApplication's catch block logs it and reports the
      // batch item failure for you.
      throw error;
    }
  }
}
```

Both paths — the caught `service-unavailable` result and an uncaught error — mean the record's
`SqsMessageContext.isSuccessful` is `false` (or, for a thrown error, `SqsApplication`'s `catch` block
reports the failure directly without ever reading `isSuccessful`). Either way the message ID ends up in
`batchItemFailures`. (`IPaymentGateway` is a dependency resolved via `static inject` — see
[Message Handlers](../message-handlers.md) for the injection convention and
[Mocking External Dependencies](mocking-dependencies.md) for faking it in tests.)

### 2. Add in-process retry with `useRetry`

`@benzenejs/resilience` provides `RetryMiddleware<TContext>`, wired into any pipeline via the free function
`useRetry<TContext>(app, options?)`. It's a single middleware with exponential backoff, nothing more; its
options mirror the C# constructor (with `TimeSpan` mapped to a millisecond `number`):

```ts
export interface RetryOptions<TContext> {
  numberOfRetries?: number;    // default 3
  initialDelayMs?: number;     // default 200
  backoffFactor?: number;      // default 2.0
  shouldRetry?: (error: unknown) => boolean;          // default: retry everything except OperationCanceledException
  shouldRetryContext?: (context: TContext) => boolean; // default: () => false — never retry a non-throwing result
  delay?: (delayMs: number) => Promise<void>;          // default: setTimeout; override in tests
}
```

Important: by default, `RetryMiddleware` only retries when the pipeline **throws**. It does *not* retry a
handler that returns a failure result (like `service-unavailable`) without throwing —
`shouldRetryContext` defaults to always returning `false`. If you want the `CapturePaymentHandler`
example above to be retried in-process (rather than only relying on SQS's own redelivery), pass a
`shouldRetryContext` that inspects `SqsMessageContext.isSuccessful`:

```ts
import { useRetry } from '@benzenejs/resilience';
import { useMessageHandlers, useSqs, SqsMessageContext } from '@benzenejs/aws-lambda';

useSqs(app, (sqs) => {
  useRetry<SqsMessageContext>(sqs, {
    numberOfRetries: 3,
    initialDelayMs: 200,
    backoffFactor: 2.0,
    shouldRetryContext: (context) => context.isSuccessful === false,
  });
  useMessageHandlers(sqs, CapturePaymentHandler);
});
```

`useRetry` must wrap `useMessageHandlers` (registered **before** it on the same builder) so that it
retries the handler invocation, not just downstream middleware.

With this wiring:

- A thrown error from `CapturePaymentHandler` is retried up to 3 times (200ms, then 400ms, then 800ms
  delay) before being allowed to propagate out of the pipeline, where `SqsApplication` catches it, logs
  it, and reports the batch item failure.
- A `service-unavailable` result is retried up to 3 times in-process (via `shouldRetryContext`) and, if
  still unsuccessful after the last attempt, `RetryMiddleware` returns normally (it does not throw for
  context-based failures) — `SqsApplication` then sees `context.isSuccessful === false` and reports the
  batch item failure exactly as if there were no retry middleware at all.

`@benzenejs/resilience` ships only this retry middleware — there is no circuit breaker, timeout, or
bulkhead. For those, reach for the sibling `@benzenejs/cockatiel` package, which adapts the
[cockatiel](https://github.com/connor4312/cockatiel) resilience library (retry, circuit breaker,
timeout, bulkhead, fallback) as pipeline middleware via `useResiliencePipeline` — see
[Resilience](../resilience.md#beyond-retry).

### 3. Wire it into a deployable function

The whole function is one entry point over the shared startup (identical to the
[getting-started-aws.md](../getting-started-aws.md) shape):

```ts
// src/startUp.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers, AwsLambdaHost, useAwsLambda, useSqs, SqsMessageContext } from '@benzenejs/aws-lambda';
import { useRetry } from '@benzenejs/resilience';
import { CapturePaymentHandler } from './CapturePaymentHandler.js';
import { StripePaymentGateway, IPaymentGateway } from './PaymentGateway.js';

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
    services.addScoped(IPaymentGateway, StripePaymentGateway);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) =>
      useSqs(aws, (sqs) => {
        useRetry<SqsMessageContext>(sqs, {
          shouldRetryContext: (context) => context.isSuccessful === false,
        });
        useMessageHandlers(sqs, CapturePaymentHandler);
      }),
    );
  }
}

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

### 4. Let genuinely-failed messages flow to SQS, then to a DLQ

Once `useRetry` gives up (or a non-retryable error is thrown), `SqsApplication` reports that message's ID
in `batchItemFailures`. From here everything is native SQS behavior, not Benzene code:

- AWS Lambda's SQS event source mapping reads `batchItemFailures` and makes **only those messages**
  visible again on the queue (instead of the whole batch), once their visibility timeout expires.
- If the source queue has a redrive policy, SQS tracks each message's approximate receive count. Once a
  message has been received (and failed) `maxReceiveCount` times, SQS moves it off the source queue and
  onto the configured dead-letter queue automatically.

**Benzene does not configure any of this.** The TypeScript port ships no infrastructure code generator —
DLQ, redrive, and event-source-mapping setup is entirely your own IaC (Terraform, the Serverless
Framework, AWS SAM/CDK, …). A hand-written Terraform example:

```hcl
resource "aws_sqs_queue" "orders_dlq" {
  name                      = "orders-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "orders" {
  name = "orders"

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.orders_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_lambda_event_source_mapping" "orders" {
  event_source_arn = aws_sqs_queue.orders.arn
  function_name    = aws_lambda_function.orders_processor.arn
  batch_size       = 10

  # Required for batchItemFailures to have any effect. Without this, AWS ignores the response
  # entirely and either the whole batch succeeds or the whole batch is retried.
  function_response_types = ["ReportBatchItemFailures"]
}
```

`maxReceiveCount: 5` combined with `useRetry({ numberOfRetries: 3 })` means a message can be attempted up
to 4 times in-process per Lambda invocation, times up to 5 separate SQS deliveries — tune both numbers
together rather than independently.

## Testing

The package's own test suite (`test/Benzene.Core.Test/Aws/Sqs/SqsPipelineTest.test.ts`) is the best
reference for exercising this without a real queue: boot a `StartUp` through `benzeneTestHost(...)`, feed
it an `SQSEvent`, and assert on the returned `batchItemFailures`.

```ts
import { describe, expect, it } from 'vitest';
import { SQSEvent } from 'aws-lambda';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers, useAwsLambda, useSqs } from '@benzenejs/aws-lambda';
import { benzeneTestHost, messageBuilder } from '@benzenejs/testing';
import { asSqs } from '@benzenejs/aws-lambda-testing';
import { CapturePaymentHandler } from '../src/CapturePaymentHandler.js';
import { IPaymentGateway, PaymentGatewayUnavailableError } from '../src/PaymentGateway.js';

// A minimal composition root — just the handler on SQS (no retry) — to isolate the failure report.
class SqsStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useSqs(aws, (sqs) => useMessageHandlers(sqs, CapturePaymentHandler)));
  }
}

describe('CapturePaymentHandler on SQS', () => {
  it('reports a failed message so SQS redelivers just that one', async () => {
    // A gateway that always reports itself unavailable, so the handler returns service-unavailable.
    const gateway: IPaymentGateway = {
      captureAsync: () => Promise.reject(new PaymentGatewayUnavailableError()),
    };

    // Boot the StartUp, overriding IPaymentGateway with the fake (last-registration-wins).
    const host = benzeneTestHost(SqsStartUp)
      .withServices((services) => services.addScopedInstance(IPaymentGateway, gateway))
      .buildAwsLambdaHost();

    // asSqs turns a message builder into a native SQSEvent; the topic becomes the `topic` attribute.
    const event = asSqs(
      messageBuilder('order:payment-capture', { orderId: '42', amount: 100 }),
    ) as SQSEvent;

    const response = await host.sendEventAsync<{
      batchItemFailures: { itemIdentifier: string }[];
    }>(event);

    expect(response.batchItemFailures).toHaveLength(1);
  });
});
```

For a mixed batch (some records succeed, some fail), hand-build the `SQSEvent.Records` array with
different `topic` attributes rather than using `asSqs` (which emits identical records) — see the package
test for that shape. To test `useRetry` deterministically, pass `delay: () => Promise.resolve()` so the
test doesn't wait out the exponential backoff. See [Mocking External Dependencies](mocking-dependencies.md)
for faking `IPaymentGateway` and [Testing Benzene](../testing-benzene.md) for the full testing guide.

## Troubleshooting

### Messages are retried even though only one failed in the batch

Your event source mapping is missing `function_response_types = ["ReportBatchItemFailures"]` (Terraform)
or the equivalent `FunctionResponseTypes: ["ReportBatchItemFailures"]` in CloudFormation/SAM/console
config. Without it, AWS Lambda ignores the returned `batchItemFailures` entirely and treats the
invocation as fully succeeded (if it returned without throwing) or fully failed (if the invocation itself
threw) — regardless of what Benzene reports per-message.

### A handler that returns `service-unavailable` isn't being retried in-process

By default `RetryMiddleware`'s `shouldRetryContext` always returns `false` — it only retries thrown
errors unless you explicitly pass `shouldRetryContext: (context) => context.isSuccessful === false` (or
your own predicate). This is intentional: Benzene has no way to know whether a non-throwing "failure"
result should be retried without you telling it.

### Messages never reach the DLQ

Check the source queue's `redrive_policy` — `maxReceiveCount` controls how many *deliveries* (not
Benzene retries) a message survives before SQS moves it to the DLQ. If `useRetry` masks every failure by
eventually succeeding, the message never gets reported as failed, so SQS never redelivers it, and it
never reaches `maxReceiveCount`.

## Variations

### Skip in-process retry, rely purely on SQS redelivery

If a failure is expensive to retry immediately (e.g. a downstream system that needs a full
visibility-timeout's worth of backoff), don't add `useRetry` at all — let the handler fail fast, report
the batch item failure, and let SQS's own visibility timeout and redrive policy handle the retry cadence.
This is cheaper (no extra Lambda duration spent retrying) and lets you tune backoff purely at the queue
level.

### Only retry specific error types

Pass a narrower `shouldRetry` predicate so unrelated bugs (e.g. a `TypeError` from bad code) fail
immediately instead of being retried three times first:

```ts
useRetry<SqsMessageContext>(sqs, {
  shouldRetry: (error) => error instanceof PaymentGatewayUnavailableError,
});
```

## Further Reading

- [SNS Fan-Out Pattern](sns-fan-out.md) — broadcasting one event to multiple SNS/Lambda consumers, and
  its different (fire-and-forget) failure model.
- [Mocking External Dependencies](mocking-dependencies.md) — faking `IPaymentGateway` in vitest.
- [Message Handlers](../message-handlers.md) — the `@message` decorator, `IMessageHandler`, and
  `static inject`.
- [Message Results](../message-result.md) — the `BenzeneResult` factory, statuses, and their transport
  mapping.
- [Middleware](../middleware.md) — middleware pipeline ordering.
- [AWS Lambda event source mapping for SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html) —
  `ReportBatchItemFailures` and partial batch responses.
- [AWS SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).
