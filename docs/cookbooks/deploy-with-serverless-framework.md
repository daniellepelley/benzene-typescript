# Deploying a Benzene Lambda with the Serverless Framework

Deploy a Benzene AWS Lambda using the [Serverless Framework](https://www.serverless.com/) (`serverless.yml`)
instead of SAM or CDK — and keep the one thing that has to stay in sync between your infra config and your
Benzene pipeline actually in sync.

## Problem Statement

Benzene is an application/runtime framework: it owns what runs *inside* your Lambda (the entry point,
message routing, middleware, DI). It is deliberately agnostic about *how* the Lambda gets deployed.

If your team has standardized on the Serverless Framework across a polyglot estate (Node, Python, …) and
you want your Benzene services to deploy through the same `serverless.yml` and CI pipeline as everything
else, this cookbook shows you how. Because Benzene and the Serverless Framework sit on **different layers
of the stack** (runtime vs. provisioning), there's no integration package to install — a Benzene Lambda is
just a normal Node.js Lambda whose handler string points at your `AwsLambdaHost` handler export, and the
Serverless Framework deploys it like any other Node function.

The one seam worth understanding up front: Benzene lets a single Lambda accept **several** event sources,
but only the ones you explicitly wire in code. Your `serverless.yml` `events:` list and your Benzene
pipeline's `use*(...)` calls must agree — [see below](#the-one-seam-keep-events-and-use-in-sync).

## Who this is for

- Teams already running the Serverless Framework and wanting Benzene/TypeScript services in the same
  pipeline.
- Anyone who prefers `serverless.yml`'s function-and-event model over hand-writing CloudFormation.

If you're not already invested in the Serverless Framework, the SAM path in
[AWS Lambda Setup](../getting-started-aws.md#6-bundle-and-deploy) is a first-class Benzene-documented
option and worth comparing first.

> **Licensing note.** Serverless Framework **v4** moved to a paid model for organizations above a revenue
> threshold and requires a login/access key (`SERVERLESS_ACCESS_KEY`). **v3** is the last fully-open
> release. This cookbook's `serverless.yml` works on both; pick the version that fits your situation.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene AWS Lambda project — see
  [AWS Lambda Setup](../getting-started-aws.md).
- The Serverless Framework CLI: `npm install -g serverless`.
- AWS credentials configured (`aws configure`, or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars).

## How the two layers divide the work

This is the whole mental model, and it's why there's nothing to install:

| Concern | Owned by |
|---|---|
| Entry point, message routing, middleware, DI, serialization | **Benzene** (a `StartUp` + `AwsLambdaHost`) |
| Bundling the artifact, provisioning the function, wiring triggers, IAM, other resources | **Serverless Framework** (`serverless.yml`) |
| The **handler string** and **which event sources are enabled** | **Both** — they must agree |

The Benzene side is exactly the entry point from [AWS Lambda Setup](../getting-started-aws.md). `src/index.ts`
exports the bound handler:

```ts
// src/startUp.ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { PlaceOrderHandler } from './handlers.js';

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, PlaceOrderHandler)));
  }
}
```

```ts
// src/index.ts
import { AwsLambdaHost } from '@benzenejs/aws-lambda-core';
import { StartUp } from './startUp.js';

// The function the Serverless Framework's `handler:` string points at.
export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

That gives Lambda a Node handler string of the form `file.export` — here, `index.handler` (the `handler`
export of the bundled `index` file). Everything else in this cookbook is the Serverless Framework side.

> **Export the bound handler.** Always `export const handler = new AwsLambdaHost(StartUp).lambdaHandler`,
> never `export const handler = host.functionHandlerAsync` — assigning the method detaches `this` and the
> pipeline is lost at the first invocation. See
> [AWS Lambda Setup](../getting-started-aws.md#4-write-the-composition-root-and-the-entry-point).

## Step-by-Step Implementation

### 1. Let the Serverless Framework bundle your TypeScript with esbuild

Lambda's `nodejs22.x` runtime runs a single JavaScript file. The
[`serverless-esbuild`](https://github.com/floydspace/serverless-esbuild) plugin bundles `src/index.ts` (and
its dependencies) into that file at deploy time — the same [esbuild](https://esbuild.github.io/) tool the
[AWS Lambda Setup](../getting-started-aws.md#6-bundle-and-deploy) guide runs by hand:

```bash
npm install --save-dev serverless-esbuild esbuild
```

### 2. Write `serverless.yml`

Drop this next to your `package.json`. It deploys a single Lambda behind an HTTP API:

```yaml
service: benzene-orders

provider:
  name: aws
  runtime: nodejs22.x
  architecture: arm64       # cheaper/faster on Graviton (see Lambda Cold Start Optimization)
  region: eu-west-1
  memorySize: 1024
  timeout: 30

plugins:
  - serverless-esbuild

custom:
  esbuild:
    bundle: true
    minify: true
    format: esm             # Benzene packages are ESM
    target: node22
    platform: node
    # ESM banner so any transitive CommonJS `require` still resolves in an .mjs bundle
    banner:
      js: import { createRequire } from 'module'; const require = createRequire(import.meta.url);

functions:
  api:
    handler: src/index.handler   # <file>.<export> → your exported `AwsLambdaHost` handler
    events:
      - httpApi: '*'             # catch-all HTTP API → Benzene's useApiGateway pipeline
```

`handler: src/index.handler` is `file.export`: the `serverless-esbuild` plugin bundles `src/index.ts` and
Lambda calls its exported `handler`.

### 3. Deploy

```bash
serverless deploy
```

The CLI bundles with esbuild, synthesizes a CloudFormation stack, and deploys it. On success it prints the
HTTP API endpoint. Hit it with a `POST` body (the TypeScript port binds the request **body**, not path
segments — see [AWS Lambda Setup](../getting-started-aws.md)):

```bash
curl -X POST https://<api-id>.execute-api.eu-west-1.amazonaws.com/orders \
  -H 'content-type: application/json' -d '{"customerId":"acme"}'
# → {"orderId":"order-acme"}
```

To tear it all down: `serverless remove`.

## The one seam: keep `events:` and `use*(...)` in sync

This is the only Benzene-specific gotcha, and it's the same drift risk any "code and infra live in
separate files" setup has.

A single Benzene Lambda can accept several AWS event sources at once, but which ones it *actually* accepts
is decided in code. Under the TypeScript port's type erasure, two transports can't share one DI container,
so a single function that fronts **several** triggers uses `compositeAwsLambda`: one exported `handler`,
each transport in its own isolated route, selected by an event-shape predicate
(see [AWS Lambda Setup](../getting-started-aws.md#model-b--one-lambda-function-several-triggers-compositeawslambda)):

```ts
// src/index.ts — one function fronting HTTP + SQS + SNS
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import {
  compositeAwsLambda,
  isApiGatewayEvent,
  isSqsEvent,
  isSnsEvent,
  toLambdaHandler,
} from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { useSqs } from '@benzenejs/aws-lambda-sqs';
import { useSns } from '@benzenejs/aws-lambda-sns';
import { PlaceOrderHandler, NotifyWarehouseHandler, AuditOrderHandler } from './handlers.js';

const entryPoint = compositeAwsLambda((c) => {
  c.configureServices((services) => addBenzene(services)); // applies to every route
  c.route(isApiGatewayEvent, (app) => useApiGateway(app, (api) => useMessageHandlers(api, PlaceOrderHandler)));
  c.route(isSqsEvent, (app) => useSqs(app, (sqs) => useMessageHandlers(sqs, NotifyWarehouseHandler)));
  c.route(isSnsEvent, (app) => useSns(app, (sns) => useMessageHandlers(sns, AuditOrderHandler)));
});

export const handler = toLambdaHandler(entryPoint);
```

> The single-transport case is simpler: a `StartUp` booted with `new AwsLambdaHost(StartUp).lambdaHandler`
> (as in the first snippet above). `compositeAwsLambda` is the lower-level builder you reach for only when
> one function must front **several** triggers.

At runtime the composite picks the first route whose predicate matches the incoming event and delegates.
**If a payload arrives that no route claims, the entry point throws.** So the rule is: **every event source
you wire in `serverless.yml` must have a matching route (or `use*`) in code, and vice versa.**

A multi-source `serverless.yml` that matches the composite above:

```yaml
functions:
  worker:
    handler: src/index.handler
    events:
      - httpApi: '*'                                       # ↔ c.route(isApiGatewayEvent, …)
      - sqs:
          arn: arn:aws:sqs:eu-west-1:123456789012:orders   # ↔ c.route(isSqsEvent, …)
          functionResponseType: ReportBatchItemFailures    # partial batch failures (see the SQS cookbook)
      - sns:
          arn: arn:aws:sns:eu-west-1:123456789012:order-events  # ↔ c.route(isSnsEvent, …)
```

- Wire an `sqs` event but forget the `isSqsEvent` route → the Lambda is invoked, no route claims the SQS
  event, and it throws.
- Add the route but no `sqs` event → the route is never exercised (harmless, just dead wiring).

> **Two triggers, one function, one container?** No — see above. If you'd rather deploy **one function per
> transport** (the port's Model A default), give each its own `src/<transport>.ts` with its own `StartUp`
> booted by `new AwsLambdaHost(StartUp).lambdaHandler`, and a separate `serverless.yml` `functions:` entry per file.
> Splitting like this doesn't multiply cold starts — see
> [Lambda Cold Start Optimization](lambda-cold-start-optimization.md).

## Local development

`serverless-offline` emulates API Gateway/Lambda for Node functions, so it *can* run a Benzene handler
locally. But Benzene's own local paths are a faster inner loop and need no AWS emulation:

- **Host the same handlers on [Express](../getting-started.md)** (`@benzenejs/express`) for a plain local
  HTTP server — the point of "write your handlers once, host them anywhere".
- **Drive the pipeline in-process from a test** with `@benzenejs/aws-lambda-testing` — no bundle, no deploy
  (see [Testing](#testing)).

## Testing

Deployment config isn't unit-testable, but the handler behind it is — and the same handler runs identically
whether SAM, CDK, or the Serverless Framework deployed it. Test the pipeline in-process: build the native
event with `@benzenejs/aws-lambda-testing`'s `asApiGatewayRequest` over `@benzenejs/testing`'s `httpBuilder`,
and invoke the exported `handler`:

```ts
// test/api.test.ts
import { describe, expect, it } from 'vitest';
import { Context } from 'aws-lambda';
import { httpBuilder } from '@benzenejs/testing';
import { asApiGatewayRequest } from '@benzenejs/aws-lambda-testing';
import { handler } from '../src/index.js';

const context = {} as Context;
const noopCallback = () => undefined;

describe('orders api', () => {
  it('POST /orders returns a 201 confirmation', async () => {
    const event = asApiGatewayRequest(httpBuilder('POST', '/orders', { customerId: 'acme' }));

    const response = (await handler(event, context, noopCallback)) as { statusCode: number; body: string };

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual({ orderId: 'order-acme' });
  });
});
```

To sanity-check the *deployed* function without curl-ing the URL:

```bash
serverless invoke --function api --path event.json
serverless logs --function api --tail            # stream CloudWatch logs
```

See [Testing Benzene](../testing-benzene.md) for the full in-process pattern.

## Troubleshooting

### The function throws on invocation, but the handler is never entered

A payload reached the Lambda that no route/`use*` claimed — the
[`events:` ↔ `use*` seam](#the-one-seam-keep-events-and-use-in-sync). You wired an event source in
`serverless.yml` with no matching route in code. Add the route (or remove the event).

### `Runtime.HandlerNotFound` / handler not found

The `handler:` string doesn't match your bundle. It's `<file>.<export>` — for `src/index.ts` exporting
`handler`, it's `src/index.handler`. If your entry file is elsewhere, update the path segment.

### Function crashes immediately / "cannot read properties of undefined"

You almost certainly wrote `export const handler = host.functionHandlerAsync`, which detaches `this`.
Use `export const handler = new AwsLambdaHost(StartUp).lambdaHandler`.

### Architecture mismatch (`exec format error` in the logs)

A native dependency was built for a different architecture than `architecture:` in `serverless.yml`. For
pure-JS Benzene bundles this is rare; if you pull in a native module, build for the matching arch (`arm64`
or `x86_64`) consistently.

### The SQS trigger is configured but messages aren't retried per-message

That's a Benzene runtime concern (partial batch failure), not a Serverless Framework one — it needs
`functionResponseType: ReportBatchItemFailures` on the SQS event (shown above). See
[Handling SQS Message Failures](handling-sqs-failures.md).

## Variations

### Declare the queue/topic in the same stack

Instead of referencing an existing ARN, let the Serverless Framework provision it under `resources:` and
reference it with `Fn::GetAtt`:

```yaml
functions:
  worker:
    handler: src/index.handler
    events:
      - sqs:
          arn:
            Fn::GetAtt: [OrdersQueue, Arn]
          functionResponseType: ReportBatchItemFailures

resources:
  Resources:
    OrdersQueue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: orders
```

### Scope IAM explicitly

The Serverless Framework attaches a broad default role. Tighten it to what each event source needs:

```yaml
provider:
  iam:
    role:
      statements:
        - Effect: Allow
          Action: [sqs:ReceiveMessage, sqs:DeleteMessage, sqs:GetQueueAttributes]
          Resource: arn:aws:sqs:eu-west-1:123456789012:orders
```

### Other event sources

Benzene's Lambda routers cover API Gateway (v1/v2), SQS, SNS, EventBridge, DynamoDB Streams, Kinesis, S3,
and Kafka. Each maps to a Serverless Framework event key (`httpApi`, `sqs`, `sns`, `eventBridge`, `stream`,
`s3`, …). The pattern is always the same: add the event in `serverless.yml`, add the matching route/`use*`
in code.

## Further Reading

- [AWS Lambda Setup](../getting-started-aws.md) — the entry point, esbuild bundling, and the Model A / Model
  B deployment shapes.
- [Lambda Cold Start Optimization](lambda-cold-start-optimization.md) — arch/memory/bundle tuning for
  `serverless.yml`.
- [Handling SQS Message Failures](handling-sqs-failures.md) — partial batch failure reporting for the `sqs`
  event source.
- [Testing Benzene](../testing-benzene.md) — testing the handler in-process, independent of how it's
  deployed.
- [Serverless Framework — AWS Lambda events](https://www.serverless.com/framework/docs/providers/aws/events/apigateway).
