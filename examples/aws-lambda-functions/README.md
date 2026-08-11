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

Each function module ships its own unified `BenzeneStartUp` and exports the `handler` AWS invokes via the
one-liner `new AwsLambdaHost(StartUp).lambdaHandler` — the SAME composition-root shape on every cloud
(compare [`../azure-functions`](../azure-functions) and [`../google-cloud-functions`](../google-cloud-functions)):

```ts
// src/functions/sqs.ts
class SqsStartUp implements BenzeneStartUp {
  configureServices(services) { addBenzene(services); }
  configure(app) {
    useAwsLambda(app, (aws) => useSqs(aws, (sqs) => useMessageHandlers(sqs, NotifyWarehouseHandler)));
  }
}

export const handler = new AwsLambdaHost(SqsStartUp).lambdaHandler;
```

`new AwsLambdaHost(StartUp)` builds the pipeline once on module load (cold start) and `.lambdaHandler` is
the correctly-bound function AWS calls. **Do not** write
`export const handler = host.functionHandlerAsync`: it compiles but detaches `this` and crashes at the
first invocation. `.lambdaHandler` is the pit of success. Only the `use<Transport>` line inside `configure`
differs between the five modules — the handler, the host, and the boot are identical.

## Deploying

Point each Lambda function's handler at the corresponding module, e.g. in `serverless`/SAM/CDK the
handler string is `src/functions/sqs.handler`. The API Gateway function is request/response (it returns
an order confirmation); the SQS/SNS/EventBridge/Kafka functions are event consumers.

## Verify it

`test/Benzene.Core.Test/Examples/AwsLambdaFunctionsExampleTest.test.ts` builds each transport's native
event with `@benzene/aws-lambda-testing` and invokes the exported `handler` exactly as AWS would,
asserting the shared handler ran — proof the "one domain, five transports" wiring routes end-to-end.
