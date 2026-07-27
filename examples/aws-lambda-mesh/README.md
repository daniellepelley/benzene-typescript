# AWS Lambda mesh — self-discovery, end to end

The TypeScript equivalent of .NET's [`examples/AwsMesh`](https://github.com/daniellepelley/benzene-dotnet/tree/main/examples/AwsMesh):
**six** Benzene Cloud Service Lambdas that describe themselves and are directly invocable, plus a **mesh**
that discovers them by tag, interrogates each over a synchronous Lambda invoke, and aggregates the estate
into a catalog.

The whole chain runs **in-memory** — no AWS account — because the two AWS surfaces the mesh touches are
stubbed with in-process stand-ins (`src/localAwsEnvironment.ts`): a Lambda client that routes an `Invoke`
straight to the target service's in-process `handler`, and a discovery client that answers
`ListFunctions`/`ListTags`. `test/Benzene.Core.Test/Examples/AwsLambdaMeshExampleTest.test.ts` drives and
asserts the end result.

## The estate

```
  orders ──payments:capture (SQS)──▶ payments ──shipping:book (SQS)──▶ shipping
    │                                    │                                 │
    └─order:placed (SNS)─▶ inventory,    ├─payment:captured (EventBridge)─▶ analytics, notifications
                          notifications  │
                                         └─ shipping ─shipment:dispatched (EventBridge)─▶ inventory, notifications, analytics
```

Each service is **one Lambda** — a composite entry point (`compositeAwsLambda`) that:

- answers a **direct Lambda invoke** carrying the reserved `spec`/`healthcheck` topics — the surface the
  mesh interrogates — via `useBenzeneMessage` (`@benzene/aws-lambda-core`), returning a self-derived spec
  (`requests`/`events`/`transports`) and a health report;
- hosts its domain handlers over every transport it actually listens on (API Gateway, SQS, SNS,
  EventBridge), routed by the composite's event-shape predicates;
- **declares** the topics it produces (spec `events`), which is what lets the mesh derive the structural
  topology — producer of a topic → every service whose `requests` contain it.

## The mesh (`src/mesh.ts`)

One `runMeshAggregation` pass does exactly what the .NET `MeshAggregateHandler` does:

1. **Discover** the benzene-tagged Lambdas — `AwsLambdaDiscoveryProvider` (`ListFunctions` + `ListTags`) →
   `aws-lambda-invoke` registry entries.
2. **Interrogate + aggregate** — `MeshAggregator` resolves each entry to the `LambdaMeshServiceSource`,
   which invokes the service on `spec` and `healthcheck`, then writes the catalog:
   `manifest.json`, `services/*.json`, `topics.json`, `topology.json`, `asyncapi.json`.

Here the catalog is written to a `FileSystemMeshArtifactStore` (the .NET example writes to S3 via
`Benzene.Mesh.Aws.S3`); the discovery + interrogation wiring is otherwise identical.

## What this proves

Running the test asserts the full mesh story on a real, non-trivial graph:

- all six tagged Lambdas are **discovered** as `aws-lambda-invoke` entries;
- each is **interrogated** and reported **healthy**, with its self-derived transports;
- the **topic catalog** lists each cross-service topic's producers and consumers;
- the **structural topology** has all nine producer→consumer edges;
- a service genuinely answers a **direct Lambda invoke** on `spec` (the interrogation seam), and the same
  service handles its domain topic over a **real transport** (SQS).

## Runtime cascade

The services don't just *declare* their edges — they **send** them. `orders`, `payments`, and `shipping`
inject `IBenzeneMessageSender` and publish their downstream topics through the real outbound clients
(`@benzene/clients-aws-{sqs,sns,eventbridge}`, wired via `addOutboundRouting`). A single `POST /orders`
therefore fans all the way through the estate — orders → payments → shipping over SQS, plus the SNS and
EventBridge fan-outs to inventory / notifications / analytics — in one call. The
`AwsLambdaMeshExampleTest` "runtime cascade" case asserts every service is reached.

The sends land on an in-memory `MeshBus` (`src/bus.ts`), the SQS/SNS/EventBridge stand-in: each fake AWS SDK
client reads the topic + body back off the command the outbound converter built and delivers it to the
services registered as consumers of that topic (as a real inbound event), so the whole thing runs with no
cloud account. Swap the bus's fake clients for real `@aws-sdk/client-*` clients and the same code sends to
real queues/topics/buses.

## Deploying to a real AWS account

The same seven functions run unchanged on real infrastructure. `functions/` holds the production Lambda
entry points — each one binds a shared, transport-agnostic service definition (`src/services.ts`) to
**real** `@aws-sdk/client-{sqs,sns,eventbridge}` clients whose targets come from environment variables
(`functions/shared.ts`, the real-AWS counterpart of the in-memory `MeshBus`). `deploy/` is a Terraform
stack that provisions the whole estate — six tagged service Lambdas, the mesh Lambda, the SQS/SNS/EventBridge
wiring, the HTTP APIs, and the S3 catalog bucket — mirroring .NET's `examples/AwsMesh/deploy`.

```bash
npm run bundle          # esbuild → artifacts/*.zip (one tiny zip per function)
cd deploy && ./deploy.sh   # terraform init + apply (needs AWS creds + terraform)
```

The catalog the mesh builds is browsable through a **static viewer** (`web/index.html`, served from the S3
catalog bucket at the `mesh_ui_url` output) — a self-contained, language-neutral page rendering the estate,
a topology graph, and the topic catalog from the same `manifest.json`/`topics.json`/`topology.json` the mesh
writes. It's the lightweight stand-in for the .NET mesh's Lambda-served UI; a static page serves every port
equally, so it's a candidate to hoist into the cross-language spec repo later.

See [`deploy/README.md`](./deploy/README.md) for the full resource list, how to trigger the cascade against
the live estate, and the (documented) divergences from the .NET stack.

## Notes on the port

- The load-bearing new library piece this example needed is `useBenzeneMessage` /
  `BenzeneMessageLambdaHandler` (`@benzene/aws-lambda-core`) — the direct-invoke surface a service exposes
  so it can be interrogated with no HTTP. It is the port of .NET's
  `Benzene.Aws.Lambda.Core.BenzeneMessage.DirectMessageLambdaHandler`.
- The runtime sends use the ported outbound clients `@benzene/clients-aws-{sqs,sns,eventbridge}`; each
  `useX(app, target, client)` takes the AWS SDK client explicitly (the port's documented divergence from
  .NET's DI-resolved client).

Run it with `npm test` (the whole suite) or target the file:

```bash
npx vitest run test/Benzene.Core.Test/Examples/AwsLambdaMeshExampleTest.test.ts
```
