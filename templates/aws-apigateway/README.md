# __PROJECT_NAME__

A [Benzene](https://github.com/daniellepelley/benzene-typescript) service on AWS Lambda, triggered by
API Gateway, generated from the `aws-apigateway` template of `create-benzene`.

## Prerequisite: the `@benzene/*` packages

This project references the real `@benzene/*` npm packages (see `package.json`). They are **not yet
published to the npm registry**, so a plain `npm install` from the registry will fail until they are.
To build and test today, resolve them from a local Benzene TypeScript checkout — e.g. generate this
project next to the [`benzene-typescript`](https://github.com/daniellepelley/benzene-typescript)
workspace so its `node_modules/@benzene/*` symlinks are on the resolution path, or add a `paths`
mapping / `file:` links to the local packages. Once published, `npm install` works unmodified.

## Layout

```
src/
  startUp.ts                  # composition root: configureServices + configure (the one place wired)
  handler.ts                  # the Lambda entry point AWS invokes (export const handler)
  helloWorldMessageHandler.ts # the demo handler (request/response, one injected IGreeter)
  greeter.ts                  # the injected example service
test/
  helloWorldMessageHandler.test.ts  # component test: boots StartUp, sends an HTTP request through
template.yaml                 # AWS SAM template (review before deploying)
```

## Build and test locally

```bash
npm install
npm run build   # tsc --noEmit
npm test        # vitest — boots the app and sends a request through the real pipeline
```

The component test uses `benzeneTestHost(StartUp).buildAwsLambdaHost()` (from `@benzene/testing` +
`@benzene/aws-lambda-testing`) to boot the exact app `StartUp` configures, swaps `IGreeter` for a spy,
and asserts both the returned response and that the handler ran — no deployment needed.

## Deploy

Requires the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
and a Node bundler step to produce the `CodeUri` artifact (the handler entry is `src/handler.handler`).
`template.yaml` is hand-checked but **not** validated or deployed from this template — review it first.

```bash
sam build
sam deploy --guided
```

## Where to go next

- **`helloWorldMessageHandler.ts`** is where your logic goes — replace it, or add more handlers
  alongside it and pass them to `useMessageHandlers(api, ...)` in `startUp.ts`. Each handler declares
  its topic with `@message` and, for HTTP, its route with `@httpEndpoint`.
- **`startUp.ts`** wires the AWS event source(s) — add `useSqs(aws, ...)` / `useSns(aws, ...)` alongside
  `useApiGateway(...)` if this function should also handle other event sources in the same Lambda.
