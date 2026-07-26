# Getting Started

This guide takes you from an empty folder to a running Benzene service in about five minutes — no
cloud account required. You'll build a small HTTP service locally with [Express](https://expressjs.com/),
then, if you want, take the exact same message handler to AWS Lambda or Azure Functions without changing
a line of it.

If you already know you're deploying to a specific platform, you can jump straight to
[AWS Lambda Setup](getting-started-aws.md) or [Azure Functions Setup](azure-functions.md) — but starting
here first is the quickest way to see how Benzene fits together.

> **TypeScript port.** This is the TypeScript port of [Benzene](https://github.com/daniellepelley/benzene-dotnet).
> It mirrors the .NET library's shape as closely as the language allows; where the two differ, the README's
> [Porting conventions](../README.md#porting-conventions) explain why.

## What you'll build

A single endpoint, `POST /hello`, that takes a JSON body `{"name":"world"}` and returns a JSON greeting.
It's deliberately tiny so the focus stays on the moving parts you'll reuse in every Benzene service: a
**message handler**, a **topic**, and the **middleware pipeline** that connects a transport to your handler.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm
- Any editor

That's it — the local walkthrough needs nothing else installed.

## The core idea in 60 seconds

Benzene separates *what your service does* from *how it's invoked*:

- A **message handler** contains your logic. It receives a typed request and returns a typed response
  wrapped in a [result](message-result.md). It knows nothing about HTTP, Lambda, or queues.
- Each handler is mapped to a **topic** — a stable string like `hello:world` that identifies the
  operation. Handlers self-register when their module loads (via the `@message` decorator), so there's no
  routing table to maintain.
- A **transport** (Express here; AWS Lambda or Azure Functions elsewhere) is wired up in a **middleware
  pipeline** that turns an incoming request into a message, routes it to the matching handler by topic, and
  turns the result back into a transport-native response.

Because only the transport pipeline changes between hosts, the handler you write below runs unchanged on
every platform Benzene supports. See [Message Handlers](message-handlers.md) and [Middleware](middleware.md)
for the full picture.

## 1. Create the project

```bash
mkdir hello-benzene && cd hello-benzene
npm init -y
npm pkg set type=module
```

Setting `type=module` makes this an ES-module project, which Benzene's packages require.

## 2. Install the packages

```bash
npm install @benzene/express @benzene/core-message-handlers @benzene/http @benzene/results \
  @benzene/abstractions @benzene/abstractions-message-handlers express
npm install --save-dev typescript tsx @types/express
```

`@benzene/express` is the Express host adapter; it brings in the middleware pipeline and message-handler
infrastructure. The `@benzene/*` abstraction packages supply the types your handler references, and
[`tsx`](https://github.com/privatenumber/tsx) lets you run TypeScript directly without a build step.

## 3. Write a message handler

Create `src/HelloWorldHandler.ts`. This is where your logic lives — and the only file you'd carry over
verbatim if you later moved to Lambda or Azure Functions:

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';

// Payloads are classes, not interfaces: the runtime recovers the erased request type from its
// constructor (for topic/schema keying), which an interface can't provide.
export class HelloWorldRequest {
  name?: string;
}

export class HelloWorldResponse {
  message?: string;
}

@httpEndpoint('POST', '/hello')
@message('hello:world', { requestType: HelloWorldRequest, responseType: HelloWorldResponse })
export class HelloWorldHandler implements IMessageHandler<HelloWorldRequest, HelloWorldResponse> {
  handleAsync(request: HelloWorldRequest): Promise<IBenzeneResultOf<HelloWorldResponse>> {
    const response = new HelloWorldResponse();
    response.message = `Hello ${request.name ?? 'world'}!`;
    return Promise.resolve(BenzeneResult.ok(response));
  }
}
```

Two decorators do the wiring:

- `@message('hello:world', …)` maps the handler to its topic and self-registers it when the module loads.
  Every Benzene transport routes by topic, so this is the identifier that stays constant across HTTP,
  Lambda, SQS, and the rest. The `requestType`/`responseType` give the runtime the concrete classes it
  needs (TypeScript erases generics, so they can't be inferred).
- `@httpEndpoint('POST', '/hello')` maps an HTTP method and path onto that same topic.

The return type — `Promise<IBenzeneResultOf<HelloWorldResponse>>` — is the response wrapped in a
[result](message-result.md), which carries success/failure status alongside the payload.
`BenzeneResult.ok(...)` is the success case.

> **A note on request binding.** Benzene binds the JSON **request body** onto your request object, so
> `POST /hello` with `{"name":"world"}` populates `request.name`. Unlike .NET, the TypeScript port does
> **not** bind path/query segments onto a bodyless request (it can't default-construct the erased DTO the
> way C#'s `Activator.CreateInstance` does) — so this guide uses a `POST` body rather than the .NET guide's
> `GET /hello/{name}`. Read values a client sends in the body.

## 4. Wire up the Express host

Create `src/index.ts`:

```ts
import express from 'express';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { benzene } from '@benzene/express';
import { HelloWorldHandler } from './HelloWorldHandler.js';

const app = express();

// Mount Benzene BEFORE any body parser so it reads the raw request body.
// It turns each matching request into a message and routes it to a handler by topic.
app.use(benzene((pipeline) => useMessageHandlers(pipeline, HelloWorldHandler)));

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
```

There's a single Benzene call: `benzene((pipeline) => useMessageHandlers(pipeline, HelloWorldHandler))`
returns Express middleware that inserts Benzene into the request pipeline. `useMessageHandlers(pipeline, …)`
is the step that routes a matched request to its handler — pass every handler class you want served.

The Benzene middleware only responds to requests that match one of your `@httpEndpoint` routes — anything
it doesn't recognise falls through to the rest of the Express app, so it coexists cleanly with your
existing routes, static files, or health-check endpoints.

## 5. Run it

```bash
npx tsx src/index.ts
```

In another terminal:

```bash
curl -X POST http://localhost:3000/hello -H 'content-type: application/json' -d '{"name":"world"}'
```

```json
{"message":"Hello world!"}
```

That's a complete Benzene service. The request arrived over HTTP, Benzene mapped `POST /hello` to the
`hello:world` topic, bound the JSON body onto `HelloWorldRequest`, invoked your handler, and serialised the
result back as JSON.

## What just happened

```
POST /hello  {"name":"world"}
      │
      ▼
@httpEndpoint route match  ──►  topic "hello:world"
      │
      ▼
HelloWorldHandler.handleAsync(request)
      │
      ▼
BenzeneResult.ok(response)  ──►  200  {"message":"Hello world!"}
```

The handler in the middle never touched an Express `req`/`res`. Swap the transport pipeline in
`src/index.ts` for an AWS Lambda or Azure Functions one and the same handler runs there — that's the
portability Benzene's hexagonal design buys you.

## Next steps

Now that you have a service running, layer on the cross-cutting concerns and platforms you need — each is a
small, self-contained addition:

- **Add validation** — reject bad requests before they reach your handler with
  [Validation](validation.md) (Zod, Joi, or Yup adapters).
- **Add correlation & logging** — trace requests end-to-end with [Correlation IDs](correlation-ids.md).
- **Understand the pipeline** — see what else you can compose in with [Middleware](middleware.md) and
  [Common Middleware](common-middleware.md).
- **Test your handlers** — [Testing Benzene](testing-benzene.md) shows how to test handlers in isolation
  and pipelines end-to-end.
- **Deploy to the cloud** — take the same handler to [AWS Lambda](getting-started-aws.md) (API Gateway,
  SQS, SNS, EventBridge, Kafka) or [Azure Functions](azure-functions.md).
- **Go deeper with recipes** — the [Cookbooks](cookbooks/README.md) cover real-world scenarios.

For complete, runnable projects covering every transport, see the [`examples/`](../examples) folder in the
repository.
