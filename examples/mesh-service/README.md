# `@benzene-example/mesh-service`

A **runnable, mesh-discoverable TypeScript Benzene HTTP service** — the "live TypeScript service in a
multi-language mesh" example. It's a real Benzene service (message handlers routed by the
`@benzenejs/express` adapter) that also serves the two language-neutral mesh-contract endpoints a mesh
aggregator interrogates, so a mesh aggregator **written in any language** — the ported TypeScript
`@benzenejs/mesh-aggregator`, or the .NET `Benzene.Mesh.Aggregator` — can discover and catalog it.

## What it exposes

| Endpoint | Purpose |
|---|---|
| `POST /orders` | The `order:create` handler (returns `created`). |
| `GET /orders/{id}` | The `order:get` handler. |
| `GET /benzene/spec?type=benzene` | The service's **spec descriptor** (`{ requests, events, transports }`), derived from the handler registry — the same JSON a .NET Benzene service serves. |
| `GET /benzene/health` | The **health document** (`{ isHealthy, healthChecks }`), the same shape .NET serves. |
| `GET /benzene/descriptor` | The normative mesh **ServiceDescriptor** (`mesh.md` §2): identity, placement, the topic list with §2.1 request/response JSON schemas, and a per-port `descriptorHash` — the same shape a .NET or Go service emits. |

Every endpoint is a projection of the running code (topics + HTTP mappings + schemas come straight from
the handlers' `@message`/`@httpEndpoint` metadata and the registered schema provider), never hand-maintained.

## Run it

```bash
npm install
npm start -w @benzene-example/mesh-service      # or: PORT=5100 npx tsx src/main.ts
```

Then interrogate it exactly as a mesh aggregator would:

```bash
curl 'http://127.0.0.1:5100/benzene/spec?type=benzene'
curl  'http://127.0.0.1:5100/benzene/health'
curl  'http://127.0.0.1:5100/benzene/descriptor'
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

Two self-description shapes are served here: the aggregator-polled **spec descriptor** (`/benzene/spec`,
topics + HTTP mappings, no per-topic schemas — the aggregator handles a schema-less descriptor fine) and
the normative **ServiceDescriptor** (`/benzene/descriptor`, `mesh.md` §2), which *does* carry per-topic
request/response JSON schemas and a `descriptorHash`. Because TypeScript erases the request/response types,
`@benzenejs/mesh-wire` derives those schemas from a pluggable `IMeshSchemaProvider` (here a hand-written
`MapMeshSchemaProvider`; in a real service a `@benzenejs/zod`/`joi`/`yup` registry) rather than CLR-type
reflection. See the root README's "Multi-language interoperability" section.
