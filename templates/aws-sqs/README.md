# __PROJECT_NAME__

A [Benzene](https://github.com/daniellepelley/benzene-typescript) service on AWS Lambda, triggered by
SQS, generated from the `aws-sqs` template of `create-benzene`.

## Prerequisite: the `@benzenejs/*` packages

This project references the real `@benzenejs/*` npm packages (see `package.json`). They are **not yet
published to the npm registry**, so a plain `npm install` from the registry will fail until they are.
To build and test today, resolve them from a local Benzene TypeScript checkout — e.g. generate this
project next to the [`benzene-typescript`](https://github.com/daniellepelley/benzene-typescript)
workspace so its `node_modules/@benzenejs/*` symlinks are on the resolution path, or add a `paths`
mapping / `file:` links to the local packages. Once published, `npm install` works unmodified.

## Layout

```
src/
  startUp.ts                  # composition root: configureServices + configure (the one place wired)
  handler.ts                  # the Lambda entry point AWS invokes (export const handler)
  helloWorldMessageHandler.ts # the demo handler (fire-and-forget, one injected IGreeter)
  greeter.ts                  # the injected example service
test/
  helloWorldMessageHandler.test.ts  # component test: boots StartUp, pushes an SQS event through
```

## Build and test locally

```bash
npm install
npm run build   # tsc --noEmit
npm test        # vitest — boots the app and pushes a message through the real pipeline
```

The component test uses `benzeneTestHost(StartUp).buildAwsLambdaHost()` (from `@benzenejs/testing` +
`@benzenejs/aws-lambda-testing`) to boot the exact app `StartUp` configures, swaps `IGreeter` for a spy,
and asserts the handler ran — no deployment needed.

## Deploy

Point your Lambda function's handler string at `src/handler.handler`. An SQS trigger needs an
event-source mapping to a queue you supply (queue ARN is deployment-specific), and an execution role
with `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`. See the
[AWS Lambda getting-started guide](https://github.com/daniellepelley/benzene-typescript) for the SQS
event-source shape.

## Where to go next

- **`helloWorldMessageHandler.ts`** is where your logic goes — replace it, or add more handlers
  alongside it and pass them to `useMessageHandlers(sqs, ...)` in `startUp.ts`.
- **`startUp.ts`** wires the AWS event source(s) — add `useApiGateway(aws, ...)` / `useSns(aws, ...)`
  alongside `useSqs(...)` if this function should also handle other event sources in the same Lambda.
