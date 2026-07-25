# `@benzene-example/mesh-service`

A **runnable, mesh-discoverable TypeScript Benzene HTTP service** — the "live TypeScript service in a
multi-language mesh" example. It's a real Benzene service (message handlers routed by the
`@benzene/express` adapter) that also serves the two language-neutral mesh-contract endpoints a mesh
aggregator interrogates, so a mesh aggregator **written in any language** — the ported TypeScript
`@benzene/mesh-aggregator`, or the .NET `Benzene.Mesh.Aggregator` — can discover and catalog it.

## What it exposes

| Endpoint | Purpose |
|---|---|
| `POST /orders` | The `order:create` handler (returns `created`). |
| `GET /orders/{id}` | The `order:get` handler. |
| `GET /benzene/spec?type=benzene` | The service's **spec descriptor** (`{ requests, events, transports }`), derived from the handler registry — the same JSON a .NET Benzene service serves. |
| `GET /benzene/health` | The **health document** (`{ isHealthy, healthChecks }`), the same shape .NET serves. |

The descriptor is a projection of the running code (topics + HTTP mappings come straight from the
handlers' `@message`/`@httpEndpoint` metadata), never hand-maintained.

## Run it

```bash
npm install
npm start -w @benzene-example/mesh-service      # or: PORT=5100 npx tsx src/main.ts
```

Then interrogate it exactly as a mesh aggregator would:

```bash
curl 'http://127.0.0.1:5100/benzene/spec?type=benzene'
curl  'http://127.0.0.1:5100/benzene/health'
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

## Scope

The descriptor lists topics + HTTP mappings but not per-topic request/response **JSON schemas** — deriving
those needs the normative `ServiceDescriptor` path (schemas from a `@benzene/zod`/`joi`/`yup` registry rather
than CLR-type reflection). The aggregator handles a schema-less descriptor fine. See the root README's
"Multi-language interoperability" section.
