# `@benzene-example/express-http`

A plain Benzene HTTP order service on a **standalone Express server** — the Node/Express analog of the
.NET `Benzene.Example.Asp`, via [`@benzenejs/express`](../../src/Benzene.Express). Benzene owns the HTTP
verbs + URLs it has `@httpEndpoint` handlers for, and everything else falls through to the ordinary Express
pipeline (the strangler-fig pattern).

The handlers in [`src/handlers.ts`](src/handlers.ts) are written once and know nothing about Express:

| Route | Handler | Effect |
|---|---|---|
| `POST /orders` | `CreateOrderHandler` | create an order → `201` |
| `GET /orders` | `ListOrdersHandler` | list every order created |
| `GET /healthz` | *(plain Express route)* | reached via the strangler fall-through — Benzene owns no handler for it |

[`src/orderService.ts`](src/orderService.ts) assembles the app: it registers the in-memory order store on a
container handed to `benzene(...)` (so the handlers get it injected), then mounts the Benzene middleware
before any body parser (so it reads the raw body).

## Run it

```bash
npm start -w @benzene-example/express-http
# then:
curl -X POST localhost:3000/orders -H 'content-type: application/json' -d '{"name":"acme"}'
curl localhost:3000/orders
```

## Verify it

`test/Benzene.Core.Test/Examples/ExpressHttpExampleTest.test.ts` starts the real Express app on an ephemeral
loopback port and drives it over HTTP with `fetch` (the same approach as the port's own `@benzenejs/express`
integration tests): it creates an order over `POST /orders`, reads it back over `GET /orders`, and confirms
the strangler fall-through to the plain `/healthz` route.
