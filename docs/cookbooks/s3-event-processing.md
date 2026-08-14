# S3 Event Processing

Trigger a Benzene Lambda when an object is uploaded to an S3 bucket, route the record to a handler by its
S3 event name, and read the bucket/key — optionally fetching the object's contents with the AWS SDK — to
process it.

## Problem Statement

A file lands in an S3 bucket (an image upload, a CSV drop, a data export) and you need a Lambda to react to
it. You want to:

- Wire an S3-triggered Lambda into Benzene's message-handler pipeline with `@benzenejs/aws-lambda-s3`.
- Route each S3 record to the right handler by its **S3 event name** (e.g. `ObjectCreated:Put`) — no
  `topic` message attribute to bolt on, unlike SQS/SNS.
- Read the object reference (bucket, key, size, ETag) inside the handler, and fetch the object body from S3
  when you actually need its contents.

This cookbook covers what `@benzenejs/aws-lambda-s3` does for you (routing an `S3Event` batch to handlers by
event name, one record at a time) and where its responsibility ends — the S3 bucket notification
configuration and the Lambda invoke permission are AWS infrastructure, not something the TypeScript port
generates.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene Lambda function — see
  [AWS Lambda Setup](../getting-started-aws.md).
- An S3 bucket, and an S3 event notification configured to invoke your Lambda on `s3:ObjectCreated:*` (see
  [Troubleshooting](#troubleshooting) — without the notification, nothing invokes the function).

## Installation

```bash
npm install @benzenejs/aws-lambda-s3 @benzenejs/aws-lambda-core @benzenejs/core-message-handlers \
  @benzenejs/results @benzenejs/abstractions @benzenejs/abstractions-message-handlers
# for the Testing section:
npm install --save-dev @benzenejs/aws-lambda-testing
```

If your handler fetches the object's contents, also install the AWS SDK's S3 client:

```bash
npm install @aws-sdk/client-s3
```

## How Benzene routes an S3 record

It's worth understanding exactly what `@benzenejs/aws-lambda-s3` does before writing any handler code, because
S3 routing differs from the queue/topic transports.

`S3LambdaHandler` claims any Lambda invocation whose event is an `S3Event` (records whose `eventSource` is
`aws:s3`, via `isS3Event`) and hands it to `S3Application`. `S3Application` maps every record in the batch to
its own `S3RecordContext` and runs them all through your middleware pipeline concurrently, each in its own DI
scope, tagging the transport as `"s3"` for the duration. S3-to-Lambda has no response and no
batch-item-failure mechanism — it is **fire-and-forget**, so the handler writes the `null` "handled"
sentinel and the entry point returns `null`.

Two things are derived from each record — and this is the whole contract:

1. **The topic is the S3 event name.** `S3MessageTopicGetter` returns `new Topic(record.eventName)`, so a
   record whose `eventName` is `ObjectCreated:Put` routes to a handler declaring
   `@message('ObjectCreated:Put', ...)`. S3's native event name **is** the routing key — there's no `topic`
   attribute to set the way SQS and SNS require.
2. **The body is a serialized `S3Notification`.** `S3MessageBodyGetter` builds a small JSON object from the
   record and hands it to the request mapper, so your handler's request type is deserialized from it. The
   shape is:

   ```ts
   // The JSON each handler's request is deserialized from (Benzene's S3Notification).
   class S3Notification {
     eventName: string | undefined;   // e.g. "ObjectCreated:Put" (also the topic)
     awsRegion: string | undefined;   // e.g. "eu-west-1"
     bucketName: string | undefined;  // record.s3.bucket.name
     key: string | undefined;         // record.s3.object.key
     size = 0;                        // record.s3.object.size ?? 0
     eTag: string | undefined;        // record.s3.object.eTag
   }
   ```

   Your handler declares a request type with any subset of these properties (matched by name) — you don't
   have to consume all of them.

> **`ObjectCreated:Put` is not `ObjectCreated:*`.** The topic is the *exact* event name, and S3 emits several
> `ObjectCreated:` sub-events (`Put`, `Post`, `Copy`, `CompleteMultipartUpload`). Routing is an exact string
> match, so a `@message('ObjectCreated:Put')` handler will **not** receive an `ObjectCreated:Copy` record.
> Either register a handler per event name you care about, or narrow the bucket notification to the single
> event you want (see [Troubleshooting](#routing-only-catches-some-uploads)).

## Step-by-Step Implementation

### 1. Write a handler keyed on the S3 event name

The request type just needs properties matching the `S3Notification` fields you care about — here the bucket
and key. The handler is an ordinary Benzene message handler; the only S3-specific part is that the
`@message` topic is the S3 **event name**.

```ts
// ProcessUploadHandler.ts
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';

// A subset of the S3Notification fields, matched by name.
export class FileUploaded {
  bucketName?: string;
  key?: string;
  size = 0;
}

export class FileProcessed {
  reference?: string;
}

@message('ObjectCreated:Put', { requestType: FileUploaded, responseType: FileProcessed })
export class ProcessUploadHandler implements IMessageHandler<FileUploaded, FileProcessed> {
  async handleAsync(request: FileUploaded): Promise<IBenzeneResultOf<FileProcessed>> {
    // request.bucketName / request.key / request.size come from the S3 record.
    const processed = new FileProcessed();
    processed.reference = `${request.bucketName}/${request.key}`;
    return BenzeneResult.ok(processed);
  }
}
```

Because S3 is fire-and-forget, the returned result isn't written to any response — it's recorded onto the
`S3RecordContext` for diagnostics only. Returning `BenzeneResult.ok(...)` versus a failure result matters for
middleware that inspects the outcome (logging, metrics), not for anything sent back to S3.

### 2. Wire it into a deployable function

One entry point over the shared startup, identical to the [getting-started-aws.md](../getting-started-aws.md)
shape. `useS3` takes the AWS event pipeline builder first and an inner pipeline action second:

```ts
// index.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useS3 } from '@benzenejs/aws-lambda-s3';
import { ProcessUploadHandler } from './ProcessUploadHandler.js';

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useS3(aws, (s3) => useMessageHandlers(s3, ProcessUploadHandler)));
  }
}

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

`useS3(app, action)` registers the S3 services (topic/body extraction, request mapping, media-format
negotiation, and an `"s3"` `ITransportInfo`), builds the per-record `S3RecordContext` pipeline from `action`,
and appends an `S3LambdaHandler`. If the invocation isn't an S3 event, `S3LambdaHandler` defers to the next
event-source adapter — so you can compose `useS3` alongside `useSqs`/`useSns` in one composite function (see
[AWS Lambda Setup](../getting-started-aws.md)).

`new AwsLambdaHost(StartUp).lambdaHandler` binds `this` — export the handler this way rather than
`host.functionHandlerAsync` directly (which would detach it).

### 3. Fetch the object's contents with the AWS SDK

The S3 record carries only the object *reference* (bucket, key, size, ETag) — never the bytes. When you need
the object's contents, fetch them with `@aws-sdk/client-s3` from inside the handler. Put the SDK behind a
small service interface with a merged `ServiceToken` (the port's convention for anything resolved from the
container) so the handler stays testable:

```ts
// ObjectStore.ts
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

export interface IObjectStore {
  getTextAsync(bucket: string, key: string): Promise<string>;
}

// The interface and the constant share a name (declaration merging) — `IObjectStore` is both the type and
// the runtime token the container resolves.
export const IObjectStore: ServiceToken<IObjectStore> = serviceToken<IObjectStore>('IObjectStore');

export class S3ObjectStore implements IObjectStore {
  private readonly client = new S3Client({});

  async getTextAsync(bucket: string, key: string): Promise<string> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    // The AWS SDK v3 Body is a stream with a convenience transformer in Node.
    return response.Body!.transformToString();
  }
}
```

Inject it into the handler with `static inject` and read the object once you have the reference:

```ts
// ProcessUploadHandler.ts (fetching the body)
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { IObjectStore } from './ObjectStore.js';

export class FileUploaded {
  bucketName?: string;
  key?: string;
}

export class FileProcessed {
  lineCount?: number;
}

@message('ObjectCreated:Put', { requestType: FileUploaded, responseType: FileProcessed })
export class ProcessUploadHandler implements IMessageHandler<FileUploaded, FileProcessed> {
  static readonly inject = [IObjectStore] as const;

  constructor(private readonly objectStore: IObjectStore) {}

  async handleAsync(request: FileUploaded): Promise<IBenzeneResultOf<FileProcessed>> {
    const contents = await this.objectStore.getTextAsync(request.bucketName!, request.key!);
    const processed = new FileProcessed();
    processed.lineCount = contents.split('\n').length;
    return BenzeneResult.ok(processed);
  }
}
```

Register the concrete store in `configureServices`:

```ts
.configureServices((services) => {
  addBenzene(services);
  services.addScoped(IObjectStore, S3ObjectStore);
})
```

(`static inject` is the injection convention — see [Message Handlers](../message-handlers.md) — and
[Mocking External Dependencies](mocking-dependencies.md) shows faking `IObjectStore` in tests.)

## Testing

`test/Benzene.Core.Test/Aws/S3/S3PipelineTest.test.ts` is the reference for exercising this without a live
bucket: boot the same `StartUp` you deploy through `benzeneTestHost(...)`, feed it an `S3Event` from the
`asS3` builder, and assert your handler ran. Unlike the queue/topic builders, `asS3` takes the `bucket` and
`key` directly (the "message" is the object reference, not a JSON payload), and the event name defaults to
`ObjectCreated:Put`:

```ts
import { describe, expect, it } from 'vitest';
import { benzeneTestHost } from '@benzenejs/testing';
import { asS3 } from '@benzenejs/aws-lambda-testing';
import { StartUp } from '../src/index.js';
import { IObjectStore } from '../src/ObjectStore.js';

describe('ProcessUploadHandler on S3', () => {
  it('routes an ObjectCreated:Put record to the handler by event name', async () => {
    const store: IObjectStore = {
      getTextAsync: () => Promise.resolve('line-1\nline-2\nline-3'),
    };

    // Boot the same StartUp you deploy, overriding IObjectStore with the fake (last-registration-wins).
    const host = benzeneTestHost(StartUp)
      .withServices((services) => services.addScopedInstance(IObjectStore, store))
      .buildAwsLambdaHost();

    // asS3(bucket, key) emits an S3Event whose single record's eventName is "ObjectCreated:Put".
    const event = asS3('my-bucket', 'photos/cat.png');

    const response = await host.sendEventAsync(event);

    // S3 is fire-and-forget: the router marks the event handled with the null sentinel.
    expect(response).toBeNull();
  });
});
```

To assert on the deserialized record fields (bucket/key/size), have the handler push what it saw into a
capture array (as the package test does with a module-level `handled` array) and assert on it. To test a
different event, pass `asS3('my-bucket', 'photos/cat.png', { eventName: 'ObjectRemoved:Delete' })`, and to
emit a multi-record batch, pass `{ numberOfRecords: 3 }`. See
[Mocking External Dependencies](mocking-dependencies.md) for faking `IObjectStore` and
[Testing Benzene](../testing-benzene.md) for the full guide.

## Troubleshooting

### The Lambda never runs when I upload a file

Benzene doesn't configure the S3 bucket notification — that's your own IaC. Check that the bucket has a
notification configuration pointing at your Lambda (`s3:ObjectCreated:*`), and that the function grants S3
permission to invoke it (`lambda:InvokeFunction` for the `s3.amazonaws.com` principal, scoped to the bucket
ARN). Without both, S3 has nothing to call.

### Routing only catches some uploads

`ObjectCreated:*` is several distinct event names (`Put`, `Post`, `Copy`, `CompleteMultipartUpload`), and the
topic is the exact event name. A `@message('ObjectCreated:Put')` handler receives only `Put` records — a
large multipart upload arrives as `CompleteMultipartUpload` and won't match. Either register a handler per
event name, or narrow the bucket notification to the single event (`s3:ObjectCreated:Put`) so only that one
is delivered.

### `BenzeneException: event not recognized`

The entry point throws when no router claims the invocation. `S3LambdaHandler` only claims events whose
records have `eventSource: "aws:s3"`; a hand-built test event missing that (or a non-S3 event) falls through
every adapter. Use the `asS3` builder, which sets `eventSource` correctly.

### The object body comes back empty or as a stream object

`@aws-sdk/client-s3`'s `GetObjectCommand` returns `Body` as a stream. In Node, call
`response.Body.transformToString()` (or `transformToByteArray()`) to materialize it, as in `S3ObjectStore`
above — don't `JSON.stringify` the stream object.

## Variations

### One function, multiple transports

`useS3` composes with the other event-source adapters on the same builder — `S3LambdaHandler` defers to the
next adapter when the event isn't an S3 event. Register `useS3`, `useSqs`, and `useSns` in the same
`configure` callback to handle all three from one deployable function; each claims only the invocations it
recognizes. See [AWS Lambda Setup](../getting-started-aws.md) for the composite deployment model.

### Fan a copy of the event out to other consumers

If several services need to react to an upload, don't wire them all into this one function — publish a domain
event from the handler and let each consumer subscribe independently. See
[Response as Event](response-as-event.md) for emitting an event from a handler's result, and
[SNS Fan-Out Pattern](sns-fan-out.md) for the broadcast topology.

### Make the handler idempotent

S3 event notifications are delivered at least once, so the same object can trigger your handler more than
once. If processing has side effects (writing a derived object, charging for a job), make the handler
idempotent — see [Idempotency](idempotency.md).

## Further Reading

- [SNS Fan-Out Pattern](sns-fan-out.md) — broadcasting one event to multiple independently-deployed
  consumers.
- [Handling SQS Message Failures](handling-sqs-failures.md) — partial batch failures and DLQs for the
  queue-based transport.
- [Mocking External Dependencies](mocking-dependencies.md) — faking `IObjectStore` in vitest.
- [Message Handlers](../message-handlers.md) — the `@message` decorator, `IMessageHandler`, and
  `static inject`.
- [AWS Lambda Setup](../getting-started-aws.md) — hosting, and the one-function-per-transport vs composite
  deployment models.
- [Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html)
  — configuring the bucket-to-Lambda trigger.
</content>
</invoke>
