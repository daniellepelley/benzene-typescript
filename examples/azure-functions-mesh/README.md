# Azure Functions mesh — end-to-end example (purely Azure Functions)

The TypeScript equivalent of .NET's
[`examples/AzureFunctionsMesh`](https://github.com/daniellepelley/benzene-dotnet/tree/main/examples/AzureFunctionsMesh):
**six** Benzene Cloud Service Azure Functions that call each other over Service Bus, Event Hub, and Event
Grid, plus a **seventh mesh Function** that discovers them via Azure Resource Manager (tag-based,
enumerating `Microsoft.Web/sites`), interrogates each over HTTPS, and aggregates a catalog to Blob
Storage on a timer trigger.

Every component here is an **Azure Function** (unlike the `examples/azure-functions` single-domain
example, which hosts one order handler on three triggers) — this is the same "mesh" shape as
`examples/aws-lambda-mesh` and `examples/k8s-mesh`, so the four language/cloud ports render identically in
the Mesh UI's topology view.

## The estate

```
orders --payment:take (Service Bus)--> payments --shipment:book (Service Bus)--> shipping
orders --order:placed (Event Hub, fan-out)--> inventory, notifications
payments --payment:captured (Event Grid)--> notifications, analytics
shipping --shipment:dispatched (Event Grid)--> inventory, notifications, analytics
```

Each Azure transport is used for what it is idiomatic for — matching .NET's own choice exactly (see that
example's README, "Interconnectivity"):

| Transport | Idiomatic for | In this example |
|---|---|---|
| **Service Bus queue** | point-to-point **command**, one consumer | `orders → payments` (`payment:take`), `payments → shipping` (`shipment:book`) |
| **Event Hub** | high-throughput **event stream**, fan-out via consumer groups | `orders` streams `order:placed` → **inventory + notifications** (a consumer group each) |
| **Event Grid** | **routed integration events**, filtered by event type | `payments` publishes `payment:captured`, `shipping` publishes `shipment:dispatched` → **notifications / inventory / analytics** |

Each of the six services is **one Function App**, tagged `benzene = "true"` for discovery, exposing
`/benzene/spec`, `/benzene/health`, `/benzene/invoke` as **JSON only** at the root (`host.json`'s
`"extensions": {"http": {"routePrefix": ""}}` — see `host.json`, copied alongside each bundle) via the
same `useBenzeneCloudService(...)` every other Cloud Service example in this repo uses. Each service also
**declares** what it sends (`addResponseEventDeclarations` → the spec's `events`), so the mesh derives the
structural topology across all six — and orders/payments/shipping actually **send** those events at
runtime through the real `@benzenejs/clients-azure-{service-bus,event-hub,event-grid}` outbound clients.

## The mesh (`src/mesh/`)

One Function App, `functions/mesh.ts`, registering **two** triggers (each its own `AzureFunctionHost` —
see "One container per trigger" below):

- an **HTTP trigger** (`MeshHttpStartUp`) serving the Mesh UI (`/mesh-ui`), the mesh-hosted per-service
  Spec UI (`/mesh-spec-ui.html`), the catalog artifacts read back from Blob Storage, and `POST
  /mesh/refresh`;
- a **timer trigger** (`MeshTimerStartUp`, `useTimerTrigger`) running the discovery + aggregation pass
  every minute — the Consumption-plan replacement for an always-on background loop.

It discovers the tagged Function Apps via `@benzenejs/mesh-discovery-azure`'s
`AzureAppServiceDiscoveryProvider` (Azure App Services and Function Apps are both `Microsoft.Web/sites`,
so this is the *exact same* provider .NET's `AzureMesh` and `AzureFunctionsMesh` examples both use),
interrogates each with the **generic** `HttpMeshServiceSource` (`@benzenejs/mesh-aggregator` — no
Azure-specific interrogation package needed, since a discovered entry is just an HTTP-addressable URL, the
same one `examples/k8s-mesh` already uses), and persists the catalog to `@benzenejs/mesh-azure-blob`'s
`BlobMeshArtifactStore`.

## Framework reuse — confirmed clean, two documented nuances

Everything this example needed already existed in this repo, unused until now: `@benzenejs/azure-function-http`
(`AzureHttpApplication`), `@benzenejs/azure-function-timer`, the three ingress packages
(`@benzenejs/azure-function-{service-bus,event-hub,event-grid}`), the three outbound clients
(`@benzenejs/clients-azure-{service-bus,event-hub,event-grid}`), `@benzenejs/mesh-discovery-azure`, and
`@benzenejs/mesh-azure-blob`. No new `src/` package, and no change to an existing one, was needed.

One nuance surfaced while wiring the Event Hub hop (`order:placed`), worth flagging explicitly:
**`@benzenejs/clients-azure-event-hub`'s own `useEventHub(...)` and `@benzenejs/azure-function-event-hub`'s
ingress don't agree on a wire shape.** The outbound client writes the topic as an event *property* (the
same convention Service Bus uses); the only Event Hub *ingress* this port has
(`BenzeneMessageEventHubHandler`, wired via `useBenzeneMessage`) requires the event body itself to
deserialize into a `{ topic, headers, body }` envelope — there is no "property-based" ingress counterpart
(unlike Service Bus, whose topic getter reads the same property the outbound converter writes). .NET hit
this identical seam in its own AzureFunctionsMesh example and closed it with a small **framework**
addition (property-based Event Hub ingress — see that example's README and
`Benzene.Azure.Function.EventHub`); that addition has not been ported to TypeScript.

Rather than port that framework change speculatively, this example solves it entirely at the example
level (`src/eventHubEnvelope.ts`): a small `useEnvelopeEventHub(...)` pairs the *existing* egress building
blocks (`IContextConverter`, `useEventHubClient`) with an envelope-shaped body — the exact convention
`OutboundQueueStorageContextConverter` already uses for its own envelope-only ingress. Service Bus and
Event Grid needed no such treatment; their ingress/egress pairs already agree on the wire shape. If a
future example needs Event Hub property-based routing without an envelope, porting .NET's framework
addition is the right fix — this file is a documented, working stand-in, not a replacement for it.

### One container per trigger (not a framework gap — a port-wide constraint this example ran into first)

.NET wires every trigger a service listens on into ONE container (one `Configure` call registers HTTP
*and* Service Bus *and* Event Hub *and* Event Grid pipelines together), because C# generics aren't erased:
`IMessageTopicGetter<AspNetContext>` and `IMessageTopicGetter<ServiceBusContext>` are different DI service
types. TypeScript erases that parameter — every transport's topic/body/headers getters collapse onto the
SAME runtime token, confirmed empirically here: wiring HTTP and Service Bus into one
`AzureFunctionApplicationBuilder` made the later-registered transport's getters answer the earlier
transport's requests too, throwing on missing fields. This is the exact generic-erasure seam other
packages in this port already work around by giving a nested pipeline its own container (see
`useBenzeneMessage`'s own doc comment), and it's why `examples/azure-functions` (this repo's existing
single-domain, three-trigger example) already gives HTTP, Service Bus, and Event Hub each their own
`BenzeneStartUp` and their own `AzureFunctionHost`. This example follows that same, already-proven
convention at scale: every (service, trigger) pair gets its own startup class (`src/startUps.ts`) and its
own `AzureFunctionHost` (`functions/*.ts`) — up to three per service. A consequence worth naming: the mesh
Function's `MeshAggregationService` single-flight gate (see `meshAggregation.ts`) now only serializes
calls *within* one container, so the HTTP container's `POST /mesh/refresh` and the Timer container's
scheduled pass are no longer coordinated by one semaphore the way .NET's are — a narrow, documented gap
that self-heals on the next pass, not a correctness issue for the mesh's core promise.

## Projects

| Path | What it is |
|---|---|
| `src/domain/` | the six services' domain handlers + payload types (one file per service, mirrors .NET's `Domain.cs` files) |
| `src/wiring.ts` | the shared "make this a mesh-discoverable Cloud Service" wiring (mirrors .NET's `Shared/MeshServiceWiring.cs`) |
| `src/eventHubEnvelope.ts` | the envelope-shaped Event Hub outbound converter (see "Framework reuse" above) |
| `src/startUps.ts` | one `BenzeneStartUp` per (service, trigger) pair — see "One container per trigger" above |
| `src/mesh/` | the mesh's discovery + aggregation service, refresh handler, and its two `BenzeneStartUp`s (HTTP, timer) |
| `src/localAzureEnvironment.ts` | test-only in-process stand-ins: a stub `IAzureResourceLister` (ARM) + a real local HTTP server wrapping a built `AzureFunctionHost` |
| `functions/` | the seven Function Apps' `@azure/functions` v4 registrations (`app.http(...)`/`app.serviceBusQueue(...)`/`app.eventHub(...)`/`app.eventGrid(...)`/`app.timer(...)`) |
| `host.json` | the shared Functions host config (`routePrefix: ""`), copied into each bundle |
| `deploy/` | Terraform: storage, Consumption plan, 7 Function Apps, Service Bus + Event Hub + Event Grid, managed identity + roles |
| `.github/workflows/mesh-example-azure-functions-{deploy,destroy}.yml` | manual-only deploy/teardown, mirroring `mesh-example-aws-lambda-{deploy,destroy}.yml` |

## Run it locally

Each Function App is a standard Node v4-model app. The mesh needs a reachable Blob endpoint
(`MESH_BLOB_URI`) and, for discovery, Azure credentials the ARM client can use (`DefaultAzureCredential` —
e.g. `az login` locally). Discovery + live interrogation are only fully exercised against real Azure
(managed identity + deployed sites), like the sibling examples — locally the value is that the whole
thing **builds and wires up** and each Function starts:

```bash
# from examples/azure-functions-mesh
npm run bundle   # esbuild -> artifacts/*.zip (one zip per Function App)
```

Deploying `artifacts/*.zip` to a real Azure account (Terraform + `az functionapp deployment source
config-zip`) is what the GitHub Actions workflow below automates; see `deploy/main.tf` for the resource
list if you want to run the same steps by hand.

The inter-service sends are best-effort: with no Service Bus/Event Hub/Event Grid connection configured
locally, a send just fails and is caught by the domain handler, so each Function still starts and serves
its Cloud Service Profile — the same posture .NET's own AzureFunctionsMesh documents for local runs.

## Verify it

`test/Benzene.Core.Test/Examples/AzureFunctionsMeshExampleTest.test.ts` drives the estate with **no real
Azure account**, mirroring `AwsLambdaMeshExampleTest.test.ts`'s in-process approach:

- **discovery** — `AzureAppServiceDiscoveryProvider` against a stub `IAzureResourceLister` (the in-process
  stand-in for Azure Resource Manager), asserting the real tag-filtering + URL-building logic runs
  end-to-end with no ARM SDK;
- **interrogation + aggregation** — each service's real, built `AzureFunctionHost.httpFunction` is served
  over a genuine local HTTP server (`listenHttpFunction`), and the real `HttpMeshServiceSource` (an
  un-mocked `fetch`) interrogates them — proving the Function-to-Function HTTP path end-to-end;
- **each transport's receiving side** — a Service Bus message, an Event Hub batch, and an Event Grid event
  are built with `@benzenejs/azure-function-testing` and driven straight at each service's real trigger
  handler, proving the ingress wiring (including the Event Hub envelope fix above) actually routes.

`AzureAppServiceDiscoveryProvider` always builds `https://` URLs (matching real Azure, which is always
TLS), so a local test can't route one discovery pass straight into interrogation without a TLS-terminating
local server; the test instead verifies discovery and interrogation as two independent seams (see
`src/localAzureEnvironment.ts`'s header comment) — together covering exactly what a single discover-then-
interrogate pass covers, with no self-signed-certificate machinery.

Run it with `npm test` (the whole suite) or target the file:

```bash
npx vitest run test/Benzene.Core.Test/Examples/AzureFunctionsMeshExampleTest.test.ts
```

## Deploy it (GitHub Actions)

The **Mesh Example Azure Functions Deploy** workflow
(`.github/workflows/mesh-example-azure-functions-deploy.yml`) is manual-only (**Actions → Mesh Example
Azure Functions Deploy → Run workflow**). Put an Azure service principal in the **`test`** GitHub
Environment as `AZURE_CREDENTIALS` (the `azure/login` JSON), with rights to create the resource group,
storage, App Service plan, Function Apps, and **to assign roles** (Owner or User Access Administrator).
Supply a globally-unique storage-account name (defaults to `benzenetsfnmesh` — must differ from every
other example's, including .NET's `AzureFunctionsMesh`, since the remote state lives in a
`<name>tfstate` account). The workflow bundles the seven Function Apps (esbuild), runs `terraform apply`,
zip-deploys each app, then a **second `terraform apply`** to wire the Event Grid subscriptions (they need
their target functions to exist first), and prints the URLs.

`deploy/` provisions a storage account (Functions runtime + the `mesh` blob container), a Linux
Consumption plan, the seven Function Apps (6 tagged services + the mesh), the **Service Bus** namespace +
queues, the **Event Hub** namespace + hub + consumer groups, the **Event Grid** topic + subscriptions, and
the mesh identity's role assignments (**Reader** on the resource group to list sites, **Storage Blob Data
Contributor** on the storage account).

## Teardown

Run the **Mesh Example Azure Functions Destroy** workflow
(`.github/workflows/mesh-example-azure-functions-destroy.yml`) — the counterpart of deploy. It uses the
same remote azurerm state, so it destroys exactly what the deploy created. Pass the same
`location`/`storage_account` you deployed with, and optionally tick **Also delete the resource group** for
a full cleanup.

## Deliberate divergences from .NET AzureFunctionsMesh

- **No Application Insights / usage feed.** .NET wires OpenTelemetry + Azure Monitor so the mesh can read
  per-topic request counts back from Log Analytics (`Benzene.Mesh.Usage.ApplicationInsights`). That's an
  enrichment beyond proving the mesh itself, and the equivalent TypeScript packages aren't part of this
  example's surface (matching `examples/aws-lambda-mesh` and `examples/k8s-mesh`, which omit OpenTelemetry
  wiring for the same reason).
- **Node v4 programming model packaging**, not .NET's self-contained isolated-worker publish. Each
  Function App is bundled to a single CommonJS file (esbuild) with no `node_modules` at runtime — the Node
  counterpart of `aws-lambda-mesh`'s zero-`node_modules` Lambda zips, adapted for `host.json` +
  `package.json` (see `scripts/bundle.mjs`). CJS, not ESM: `@azure/functions`' own prebuilt module does a
  handful of `require(...)` calls (including of Node builtins) that esbuild's `format: 'esm'` output can't
  turn into working dynamic imports (`Dynamic require of "..." is not supported` at load time); `format:
  'cjs'` sidesteps it entirely and is also the more common format for a Functions Node app. The mesh
  bundle additionally carries `mesh-ui.html`/`mesh-spec-ui.html` alongside `index.js` — `@benzenejs/mesh-
  ui` reads them with a runtime `readFileSync`, which esbuild can't see to bundle.
- **The Event Hub envelope fix** described above under "Framework reuse" — a documented example-level
  stand-in for a framework addition .NET already has.
