# `@benzene-example/aws-lambda-functions`

One order domain, **hosted on five AWS Lambda transports**. The handlers in
[`src/handlers.ts`](src/handlers.ts) are written once and know nothing about the transport that
delivered the message — that is the whole point of Benzene.

| Function (`src/functions/…`) | AWS trigger | Handler | Routes by |
|---|---|---|---|
| `apiGateway.ts` | API Gateway (HTTP) | `PlaceOrderHandler` | HTTP method + path (`POST /orders`) → topic `order:place` |
| `sqs.ts` | SQS | `NotifyWarehouseHandler` | `topic` message attribute → `order:placed` |
| `sns.ts` | SNS | `NotifyWarehouseHandler` | `topic` message attribute → `order:placed` |
| `eventBridge.ts` | EventBridge | `NotifyWarehouseHandler` | `detail-type` → `order:placed` |
| `kafka.ts` | Amazon MSK / Kafka | `NotifyWarehouseHandler` | record topic → `order:placed` |

Each function module exports the `handler` AWS invokes:

```ts
// src/functions/sqs.ts
export const handler = lambdaHandler((app) =>
  useSqs(app, (sqs) => useMessageHandlers(sqs, NotifyWarehouseHandler)),
);
```

`lambdaHandler` (see [`src/lambda.ts`](src/lambda.ts)) wires Benzene onto the container and returns
`toLambdaHandler(entryPoint)` — the correctly-bound function AWS calls. **Do not** write
`export const handler = entryPoint.functionHandlerAsync`: it compiles but detaches `this` and crashes
at the first invocation.

## Deploying

Point each Lambda function's handler at the corresponding module, e.g. in `serverless`/SAM/CDK the
handler string is `src/functions/sqs.handler`. The API Gateway function is request/response (it returns
an order confirmation); the SQS/SNS/EventBridge/Kafka functions are event consumers.

## Verify it

`test/Benzene.Core.Test/Examples/AwsLambdaFunctionsExampleTest.test.ts` builds each transport's native
event with `@benzene/aws-lambda-testing` and invokes the exported `handler` exactly as AWS would,
asserting the shared handler ran — proof the "one domain, five transports" wiring routes end-to-end.
