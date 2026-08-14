# SNS Fan-Out Pattern

Publish one event to an SNS topic and have several independent Lambda functions — each with their own SNS
trigger and their own handlers — process a copy of it.

## Problem Statement

You have one event (e.g. "order placed") that multiple, independently-deployed services need to react to:
one Lambda sends a notification email, another updates analytics, a third reconciles inventory. Rather
than the publisher knowing about every consumer, you publish once to an SNS topic and let each Lambda
subscribe independently. This cookbook covers:

- Publishing a message to SNS with the `topic` message attribute that Benzene subscribers route on.
- Wiring an SNS-triggered Lambda to Benzene's message handler pipeline with `@benzenejs/aws-lambda-sns`.
- Subscribing multiple Lambda functions to the same SNS topic, and how SNS's failure/retry model differs
  from SQS's.

> **Redelivery needs an idempotent handler.** SNS has no batch-item-failure mechanism (unlike SQS). When a
> subscriber's handler fails and you've opted into SNS retry (`SnsOptions.raiseOnFailureStatus`, or a
> cascading exception), SNS redelivers the same message with no de-duplication of its own — so the handler
> **must be idempotent**.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and an SNS topic (or the ARN of one you'll create alongside your
  Lambdas).
- One Benzene Lambda function per consumer, each independently deployable — see
  [AWS Lambda Setup](../getting-started-aws.md).

## Installation

Each subscriber Lambda:

```bash
npm install @benzenejs/aws-lambda
# for the Testing section:
npm install --save-dev @benzenejs/aws-lambda-testing
```

Publisher (whichever service raises the event). Benzene ships an SNS outbound client —
`@benzenejs/clients-aws-sns`'s `useSns` / `useSnsClient` (`SnsClientMiddleware`) — for publishing from
inside a Benzene outbound-routing pipeline (see [Clients](../clients.md) and
[Response as Event](response-as-event.md)). For a standalone publisher like the one below that isn't
itself a Benzene pipeline, publish with the AWS SDK directly:

```bash
npm install @aws-sdk/client-sns
```

## Step-by-Step Implementation

### 1. Publish to SNS

A Benzene SNS subscriber routes on the `topic` message attribute (read by `SnsMessageTopicGetter` via
`SnsUtils.getFromAttributes(context, 'topic')`), so the only contract the publisher has to honor is:
**serialize the payload as the message body and set a `topic` string message attribute** matching the
subscribers' `@message('<topic>')`.

```ts
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const sns = new SNSClient({});

export class OrderPlacedMessage {
  orderId?: string;
  total?: number;
}

export async function publishOrderPlaced(order: OrderPlacedMessage): Promise<void> {
  await sns.send(
    new PublishCommand({
      TopicArn: process.env.ORDER_EVENTS_TOPIC_ARN,
      Message: JSON.stringify(order),
      // This is what each Benzene subscriber reads to route to the right handler on the way in.
      MessageAttributes: {
        topic: { DataType: 'String', StringValue: 'order:placed' },
      },
    }),
  );
}
```

SNS has no request/response semantics beyond a publish acknowledgement, so `order:placed` is a
fire-and-forget event — there's no response payload to await from the consumers.

### 2. Give each consuming Lambda its own SNS-triggered pipeline

Each subscriber is a completely separate Lambda function/deployment. Wire `useSns` into its pipeline the
same way [`examples/aws-lambda-functions/src/functions/sns.ts`](../../examples/aws-lambda-functions) does —
one entry point over the shared startup.

**Lambda 1 — sends the customer a notification email:**

```ts
import { IBenzeneResultOf, IMessageHandler, message, useMessageHandlers, AwsLambdaHost, useAwsLambda, useSns, BenzeneResult } from '@benzenejs/aws-lambda';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IEmailService } from './EmailService.js';

export class OrderPlacedMessage {
  orderId?: string;
  total?: number;
}

export class NotificationSent {
  messageId?: string;
}

@message('order:placed', { requestType: OrderPlacedMessage, responseType: NotificationSent })
export class SendOrderConfirmationEmailHandler
  implements IMessageHandler<OrderPlacedMessage, NotificationSent>
{
  static readonly inject = [IEmailService] as const;

  constructor(private readonly emailService: IEmailService) {}

  async handleAsync(request: OrderPlacedMessage): Promise<IBenzeneResultOf<NotificationSent>> {
    const messageId = await this.emailService.sendOrderConfirmationAsync(request.orderId!);
    const sent = new NotificationSent();
    sent.messageId = messageId;
    return BenzeneResult.ok(sent);
  }
}

export class SendOrderConfirmationEmailStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    services.addScoped(IEmailService, SesEmailService);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useSns(aws, (sns) => useMessageHandlers(sns, SendOrderConfirmationEmailHandler)));
  }
}

export const handler = new AwsLambdaHost(SendOrderConfirmationEmailStartUp).lambdaHandler;
```

**Lambda 2 — a completely separate deployable, updates analytics from the same event:**

```ts
@message('order:placed', { requestType: OrderPlacedMessage, responseType: AnalyticsRecorded })
export class RecordOrderAnalyticsHandler
  implements IMessageHandler<OrderPlacedMessage, AnalyticsRecorded>
{
  static readonly inject = [IAnalyticsClient] as const;

  constructor(private readonly analytics: IAnalyticsClient) {}

  async handleAsync(request: OrderPlacedMessage): Promise<IBenzeneResultOf<AnalyticsRecorded>> {
    await this.analytics.trackAsync('order_placed', request.orderId!);
    return BenzeneResult.ok(new AnalyticsRecorded());
  }
}

// ...its own StartUp + new AwsLambdaHost(StartUp).lambdaHandler, wiring RecordOrderAnalyticsHandler...
```

Both handlers key off the same `@message('order:placed')` topic — because they live in separate Lambda
functions with separate SNS subscriptions, each function receives its own independent copy of the message
from SNS and runs it through its own pipeline. This is fan-out: the publisher sent one message; both
Lambdas received and processed it, each doing something different.

A few things to know about `@benzenejs/aws-lambda-sns` from reading `SnsApplication` directly:

- **It's fire-and-forget.** `SnsApplication.handleAsync` returns `Promise<void>` — unlike SQS's
  `SqsApplication`, there is no `batchItemFailures`-style partial-failure reporting for SNS (SNS-to-Lambda
  has no equivalent AWS mechanism). Whether a handler's exception or failure result surfaces to SNS at all
  is governed by `SnsOptions` — see below.
- **Routing is by the `topic` message attribute**, extracted by `SnsMessageTopicGetter` — set by whatever
  publishes to the topic (step 1).
- Each record runs through the transport-tagged pipeline (`TransportNames.Sns`), so `ICurrentTransport`
  reports `"sns"` inside your handler if you need transport-specific behavior.

### Configuring exception and retry behavior with `SnsOptions`

`useSns` takes an optional third `configure` callback for `SnsOptions`. Both flags default to **`false`**
in the TypeScript port (purely additive/opt-in):

```ts
import { useSns, useMessageHandlers } from '@benzenejs/aws-lambda';

useSns(
  app,
  (sns) => useMessageHandlers(sns, SendOrderConfirmationEmailHandler),
  (options) => {
    // Catch handler exceptions instead of letting them fail the invocation (no SNS retry).
    options.catchExceptions = true;
    // Escalate a non-exception failure result into a thrown SnsMessageProcessingException, so SNS
    // retries it the same way it would an unhandled exception.
    options.raiseOnFailureStatus = true;
  },
);
```

The defaults, and what each flag does:

- `catchExceptions` (default `false`) — with the default, an unhandled exception from a handler **cascades
  out of the invocation**: Lambda reports the invocation as failed, so SNS's own subscription retry policy
  applies. Set it `true` to catch-and-log instead (the invocation reports success to SNS — no retry).
- `raiseOnFailureStatus` (default `false`) — with the default, a handler returning a non-exception failure
  result (e.g. `BenzeneResult.serviceUnavailable(...)`) is **silently accepted** — no retry. Set it `true`
  to escalate that failure result into a thrown `SnsMessageProcessingException`, so SNS retries the
  notification.

> **Divergence from .NET.** The .NET `SnsOptions.RaiseOnFailureStatus` defaults to `true` (safe-by-default
> redelivery). The TypeScript port defaults **both** flags to `false`, matching the original pre-1.0
> behavior: an exception cascades, a failure result is accepted. If you want a returned failure result
> redelivered, set `raiseOnFailureStatus = true` explicitly (and make the handler idempotent).

### 3. Subscribe both Lambdas to the same SNS topic

The TypeScript port ships no infrastructure code generator, so the SNS subscription, Lambda invoke
permission, and (optionally) message-attribute filter policy are your own IaC. A hand-written Terraform
example for one subscriber — repeat it per Lambda, all pointing at the same `topic_arn`, for the fan-out:

```hcl
resource "aws_sns_topic_subscription" "order_notification" {
  topic_arn = data.terraform_remote_state.sns.outputs.order_events
  protocol  = "lambda"
  endpoint  = aws_lambda_function.order_notification.arn

  # Message-attribute filtering: this Lambda only receives events whose `topic` attribute is in the list,
  # even if unrelated Benzene topics are published to the same SNS topic ARN.
  filter_policy = jsonencode({ topic = ["order:placed"] })
}

resource "aws_lambda_permission" "allow_sns_order_notification" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.order_notification.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = data.terraform_remote_state.sns.outputs.order_events
}
```

Run the same two resources for the analytics Lambda (a different `function_name`, same `topic_arn`) and
you get a second, independent subscription pointing at the same topic — that's the fan-out: two
subscriptions, one topic, each Lambda permissioned independently. The `filter_policy` uses SNS
message-attribute filtering on `topic`, so a Lambda only receives the message topics it declared. If you
want SNS to retry delivery to a misbehaving endpoint and eventually dead-letter it, add a `redrive_policy`
to the subscription pointing at an SQS DLQ.

## Testing

`test/Benzene.Core.Test/Aws/Sns/SnsPipelineTest.test.ts` is the reference for exercising the subscriber
side without a live topic: boot the same `StartUp` you deploy through `benzeneTestHost(...)`, feed it an
`SNSEvent` from the `asSns` builder, and assert your handler ran (SNS is fire-and-forget, so the host
returns `null`).

```ts
import { describe, expect, it } from 'vitest';
import { SNSEvent } from 'aws-lambda';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAwsLambda, useSns } from '@benzenejs/aws-lambda';
import { benzeneTestHost, messageBuilder } from '@benzenejs/testing';
import { asSns } from '@benzenejs/aws-lambda-testing';
import { SendOrderConfirmationEmailHandler } from '../src/SendOrderConfirmationEmailHandler.js';
import { IEmailService } from '../src/EmailService.js';

// The composition root a deployment ships, booted with new AwsLambdaHost(SnsStartUp).lambdaHandler.
class SnsStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useSns(aws, (sns) => useMessageHandlers(sns, SendOrderConfirmationEmailHandler)));
  }
}

describe('SendOrderConfirmationEmailHandler on SNS', () => {
  it('routes an SNS notification to the handler', async () => {
    const sent: string[] = [];
    const emailService: IEmailService = {
      sendOrderConfirmationAsync: (orderId) => {
        sent.push(orderId);
        return Promise.resolve('email-1');
      },
    };

    // Boot the same StartUp you deploy, overriding IEmailService with the fake (last-registration-wins).
    const host = benzeneTestHost(SnsStartUp)
      .withServices((services) => services.addScopedInstance(IEmailService, emailService))
      .buildAwsLambdaHost();

    const event = asSns(messageBuilder('order:placed', { orderId: '42', total: 100 })) as SNSEvent;

    const response = await host.sendEventAsync(event);

    expect(sent).toEqual(['42']); // the handler genuinely ran with the deserialized body
    expect(response).toBeNull(); // SNS is fire-and-forget
  });
});
```

To assert on the failure/retry behavior, drive `SnsApplication` directly with `raiseOnFailureStatus: true`
and expect it to reject with `SnsMessageProcessingException` (as the package test does). See
[Mocking External Dependencies](mocking-dependencies.md) for faking `IEmailService` and
[Testing Benzene](../testing-benzene.md) for the full guide.

## Troubleshooting

### A new Lambda subscription never receives anything

Check the `filter_policy` on its `aws_sns_topic_subscription` — if it filters on `topic` and the publisher
didn't set that message attribute (or set a different value), SNS drops the message for that subscription
silently; it's not a Benzene-level failure at all.

### A handler exception in one subscriber doesn't show up anywhere useful

Unlike SQS, `SnsApplication` has no partial-batch-failure reporting — check your Lambda's own CloudWatch
logs. If you've set `SnsOptions.catchExceptions = true`, remember that means the exception is caught and
logged (via a logger from `ILoggerFactory`) but never reaches SNS at all, so there's no retry — expect it
in your logs rather than as a redelivery.

### A failure result isn't triggering an SNS retry

In the TypeScript port, `SnsOptions.raiseOnFailureStatus` defaults to `false`, so a returned failure
result is accepted silently (no retry). Set `raiseOnFailureStatus = true` if you want failure results
escalated and redelivered — and make the handler idempotent, since SNS redelivery has no de-duplication.

## Variations

### SNS-to-SQS fan-out for durability

If a subscriber needs message durability/backpressure (rather than raw SNS-to-Lambda, which has no queue
in front of it), subscribe an SQS queue to the topic instead of the Lambda directly (`protocol = "sqs"`),
then trigger that subscriber's Lambda from the queue with `@benzenejs/aws-lambda-sqs` as covered in
[Handling SQS Message Failures](handling-sqs-failures.md). This gets you SQS's partial-batch-failure
reporting and DLQ support for that specific subscriber, at the cost of an extra hop.

### Swallow everything for a best-effort subscriber

If a subscriber is genuinely optional (e.g. it only updates a non-critical dashboard) and you'd rather
log-and-move-on than have SNS retry a misbehaving downstream, set `catchExceptions = true` and leave
`raiseOnFailureStatus = false` (the default). Every failure — thrown or returned — is then logged and
never propagates, so SNS always sees the invocation as successful.

## Further Reading

- [Handling SQS Message Failures](handling-sqs-failures.md) — partial batch failures and DLQs for
  SQS-based subscribers.
- [Mocking External Dependencies](mocking-dependencies.md) — faking `IEmailService` in vitest.
- [Message Handlers](../message-handlers.md) — `@message` topic routing and `static inject`.
- [Message Results](../message-result.md) — the `BenzeneResult` factory and statuses.
- [AWS Lambda Setup](../getting-started-aws.md) — hosting the same handler on Lambda.
- [AWS SNS message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html).
