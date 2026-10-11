# `@benzene-example/mesh-service`

A **runnable, mesh-discoverable TypeScript Benzene HTTP service** — the "live TypeScript service in a
multi-language mesh" example. It's a real Benzene service (message handlers routed by the
`@benzenejs/express` adapter) that also serves the two language-neutral endpoints a mesh aggregator
interrogates, so a mesh aggregator **written in any language** — the ported TypeScript
`@benzenejs/mesh-aggregator`, or the .NET `Benzene.Mesh.Aggregator` — can discover and catalog it, and a
client generator in any language can generate a typed client for it.

## What it exposes

| Endpoint | Purpose |
|---|---|
| `POST /orders` | The `order:create` handler (returns `created`). |
| `GET /orders/{id}` | The `order:get` handler. |
| `GET /benzene/spec` | The service's **Contract Document** ([contract-document.md](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/contract-document.md)): identity (`service`, `serviceVersion`, `versionScheme`), `runtime`, `placement`, its `requests` (with HTTP mappings), `events` and `sends`, their payload schemas in `components.schemas`, and both hashes. `?type=openapi` and `?type=asyncapi` are served too. |
| `GET /benzene/health` | The **health document** (`{ isHealthy, healthChecks }`), the same shape .NET serves. |

The Contract Document is a service's one self-description: the document `benzene:spec` serves is also
exactly what a mesh-enabled service registers with a collector
([mesh.md §2](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/mesh.md)). It is
derived by `useSpec` from the running code — the handlers' `@message`/`@httpEndpoint` metadata, the
schemas registered in a `MapTypeJsonSchemaSource`, and the outbound declarations — never hand-maintained.
`sends` is the one list that cannot be read off the handlers (contract-document.md §3.3 forbids inferring
it by scanning code): `order:create` declares a send to `payments:capture` in a `MeshOutboundRegistry` —
no handler, no destination address, a pure contract declaration — which is what lets a collector build the
`orders -> payments` edge from the registration alone, before a single message has ever flowed
(mesh.md §4). See `src/contract.ts`.

## Run it

```bash
npm install
npm start -w @benzene-example/mesh-service      # or: PORT=5100 npx tsx src/main.ts
```

Then interrogate it exactly as a mesh aggregator would:

```bash
curl 'http://127.0.0.1:5100/benzene/spec'
curl 'http://127.0.0.1:5100/benzene/spec?type=asyncapi'
curl 'http://127.0.0.1:5100/benzene/health'
curl -X POST 'http://127.0.0.1:5100/orders' -H 'content-type: application/json' -d '{"customerId":"acme"}'
```

## Point a mesh aggregator at it

Because `/benzene/spec` and `/benzene/health` are language-neutral wire contracts, either aggregator
catalogs this TypeScript service with no knowledge that it's TypeScript:

- **TypeScript** — register it in a `MeshServiceRegistry` and run `MeshAggregator.runOnceAsync` (see
  `test/Benzene.Core.Test/MultiLanguage/RunnableServiceMeshTest.test.ts`, which starts this very service and
  drives the real aggregator against it).
- **.NET** — add a `mesh.json` entry pointing `specUrl`/`healthUrl` at this service's URLs and run the .NET
  `Benzene.Mesh.Aggregator`; it aggregates this TypeScript service alongside any .NET services in the same
  registry, deriving one cross-language catalog and topology.

To push it to a mesh **collector** instead (registration, heartbeats, traces), host the same handlers with
`useBenzeneCloudService(...).withCollector(url)` — see `examples/k8s-mesh`.

## Generate a client from it

`test/Benzene.Core.Test/CodeGen/GeneratedClientRoundTripTest.test.ts` starts this service, reads its
`GET /benzene/spec`, generates a TypeScript client with `@benzenejs/codegen-client`, and checks it matches
the committed `generated/OrdersServiceClient.ts` byte for byte.
