# Kubernetes mesh self-discovery — end-to-end example

The TypeScript equivalent of .NET's
[`examples/K8sMesh`](https://github.com/daniellepelley/benzene-dotnet/tree/main/examples/K8sMesh): three
Benzene Cloud Services running as pods, plus a **mesh service** that discovers them **by label** via the
Kubernetes API, interrogates each over plain in-cluster HTTP, and serves the Mesh UI. The three services
also **call each other** — orders → payments → shipping — over lightweight Benzene messages on HTTP, so
the mesh has real service-to-service traffic to observe, not just static specs. It runs two ways from the
same manifests: credential-free on a throwaway [`kind`](https://kind.sigs.k8s.io) cluster in CI, or on a
real **AWS EKS** cluster with the Mesh UI on the public internet (see "Deploy to AWS (EKS)" below).

This is the multi-service **mesh** estate. `examples/k8s-orders/` is a different, single-service example
(one handler over HTTP + SQS + Kafka in one process) — read that one first if you haven't; this one
builds on the same Kubernetes/kustomize conventions but is about mesh discovery, not multi-transport.

## Architecture

```
        Kubernetes namespace: benzene-ts-mesh
  ┌──────────┐   ┌───────────┐   ┌────────────┐
  │ orders   │──▶│ payments  │──▶│ shipping   │   3 Deployments (one image, MESH_SERVICE selects domain)
  │ Service  │   │ Service   │   │ Service    │   each Service labelled  benzene: "true"
  └────┬─────┘   └─────┬─────┘   └─────┬──────┘   ──▶ POST /benzene-message  (a { topic, headers, body }
       │  ▲            │  ▲            │  ▲             envelope, addressed by in-cluster DNS — the chain)
       │  │  3. each service PUSHES register + heartbeat + traces to the mesh's collector
       │  │     (http://mesh/benzene/invoke) — the live feed
       │   1. list Services (label benzene=true) via the Kubernetes API
       │   2. GET http://<svc>.<ns>.svc.cluster.local/benzene/spec|health  (interrogate — the pull feed)
       ▼
   ┌────────┐   writes manifest.json / services/*.json / topics.json / registry.json
   │  mesh  │   to /artifacts (pod volume) and serves the Mesh UI at /mesh-ui (pulled/declared,
   └────────┘   enriched in-page with the live Fleet plane: pushed/observed) — NodePort 30081
```

## Service-to-service calls — lightweight Benzene messages over HTTP

Beyond discovery, each service **chains to the next** over its neighbour's BenzeneMessage endpoint:

- **Ingress** — every service exposes `POST /benzene-message` (`useBenzeneMessage(...)` in
  `src/serviceApp.ts`, `@benzenejs/http`). A `{ topic, headers, body }` envelope POSTed there is routed to
  the service's handlers **by the envelope's topic**, exactly as a queue or a Lambda invoke would — one
  endpoint serves every topic, no per-route REST contract. It's the same server contract the Cloud
  Service Profile's own `/benzene/invoke` endpoint exposes.
- **Egress** — `orders`' `order:create` handler asks `payments` to `payment:take`, and `payments`'
  `payment:take` handler asks `shipping` to `shipment:book`, each via **`HttpBenzeneMessageClient`**
  (`src/httpBenzeneMessageClient.ts`) — the client-side mirror of `@benzenejs/http`'s
  `BenzeneMessageHttpMiddleware`, layered on `@benzenejs/clients-http`'s `fetch` adapter (see that file's
  header comment for why this small class lives in the example rather than in `@benzenejs/clients-http`
  itself). The downstream URL is the neighbour's in-cluster DNS name, injected as `DOWNSTREAM_MSG_URL`
  (e.g. `http://payments/benzene-message`); the terminal `shipping` service has none, so a
  `NullBenzeneMessageClient` stands in.

Send an order into the front of the chain and watch it propagate (from a
`kubectl -n benzene-ts-mesh port-forward svc/orders 8081:80`, or directly against a service ELB on EKS):

```bash
curl -XPOST localhost:8081/orders -H 'content-type: application/json' \
     -d '{"customerId":"cust-1","sku":"espresso","quantity":2}'
# => {"orderId":"order-...","status":"created"}   ... orders logs: payment:take -> created
#    ... payments logs: shipment:book -> created

# Or hit any service's envelope endpoint directly, addressing a topic it owns:
curl -XPOST localhost:8081/benzene-message -H 'content-type: application/json' \
     -d '{"topic":"payment:take","headers":{},"body":"{\"orderId\":\"o-9\",\"amount\":30}"}'
```

- Discovery is `@benzenejs/mesh-discovery-kubernetes`'s `KubernetesServiceDiscoveryProvider`: it lists
  Services carrying the `benzene` label and emits **HTTP** registry entries at their in-cluster DNS — so
  the aggregator's existing `HttpMeshServiceSource` interrogates them, no K8s-specific fetch source. This
  package already existed in this repo (real, not a stub) but was unwired into any example until now.
- The mesh's ServiceAccount has RBAC to **list Services** only (`k8s/mesh.yaml`). The mesh's own Service
  is **not** `benzene`-labelled, so it never discovers itself.
- The catalog lives on the mesh pod's own `emptyDir` volume (single writer + reader) — no blob store
  (`@benzenejs/mesh-aggregator`'s `FileSystemMeshArtifactStore`).
- **The live Fleet plane** (the "Fleet" nav on `/mesh-ui`, plus the live sections on each service/topic
  page) is the mesh's second, complementary lens, merged into the Mesh UI. Where the catalog renders what
  services *declare* (the aggregator's pulled + published artifacts), the Fleet plane renders what's
  *actually running*: the mesh pod also hosts a `@benzenejs/mesh-collector` at `/benzene/invoke`, and each
  Cloud Service reports to it (`.withCollector(...)`, driven by the `MESH_COLLECTOR_ENVELOPE_URL` the
  manifests set) — registrations, health heartbeats, and per-call traces. The single always-on mesh pod is
  the right home for the collector's in-memory state — the same reasoning .NET K8sMesh's README gives for
  why this live view fits K8sMesh but not a scale-to-zero deployment target. It reduces gracefully: an
  unreachable collector never fails a service, it just leaves that service's live feed empty.

## Why a LIVE Mesh UI here, unlike `examples/aws-lambda-mesh`

`examples/aws-lambda-mesh` serves a static `web/index.html` catalog viewer instead of the live
`@benzenejs/mesh-ui` package, because a Lambda mesh function scales to zero between invocations — there is
no always-on process to serve a live page from. Kubernetes has exactly the always-on process Lambda lacks
(the mesh's own Express app, running continuously), so this example serves `@benzenejs/mesh-ui` live
instead (`useMeshUi`/`useMeshSpecUi` in `src/meshApp.ts`) — matching .NET K8sMesh's own choice. The
published artifacts (`manifest.json`, `services/*.json`, …) are additionally served as plain static files
alongside the live UI, so the identical `mesh-ui.html` page would work unmodified if ever pointed at a
plain static file host instead — the primary deployment target the package's own docs describe.

## Projects

| Path | What it is |
|---|---|
| `src/domain.ts`, `src/serviceApp.ts`, `src/index.ts` | one Express Cloud Service image; `MESH_SERVICE` picks the domain (orders/payments/shipping) |
| `src/httpBenzeneMessageClient.ts` | the outbound envelope client the chain uses (egress half) |
| `src/meshApp.ts`, `src/meshAggregation.ts`, `src/meshCollector.ts`, `src/meshIndex.ts` | the discovery + aggregator + UI + collector service (K8s discovery, filesystem store, 30s background pass + `POST /mesh/refresh`) |
| `k8s/` | manifests: namespace, the 3 Deployments+Services, and the mesh (SA + RBAC + Deployment + NodePort Service), with a kustomize base for target-specific overlays |
| `deploy/` | Terraform for the AWS leg: EKS cluster + node group + the two ECR repositories |
| `deploy/eks/` | kustomize overlay over `k8s/`: images (set by the workflow) + a LoadBalancer mesh Service |
| `.github/workflows/mesh-example-k8s-deploy.yml` | build images → kind → deploy → assert 3 discovered |
| `.github/workflows/mesh-example-k8s-eks-deploy.yml` | terraform apply → push images to ECR → deploy → assert 3 discovered → print the public URLs (`destroy: true` tears it all down) |

## Run it locally (needs Docker; not run by CI on push)

```bash
kind create cluster --name benzene-ts
docker build -f examples/k8s-mesh/Dockerfile.service -t benzene-ts-k8smesh-service:local .
docker build -f examples/k8s-mesh/Dockerfile.mesh     -t benzene-ts-k8smesh-mesh:local .
kind load docker-image benzene-ts-k8smesh-service:local --name benzene-ts
kind load docker-image benzene-ts-k8smesh-mesh:local     --name benzene-ts
kubectl apply -k examples/k8s-mesh/k8s/   # -k: the directory is a kustomize base (deploy/eks overlays it)

kubectl -n benzene-ts-mesh port-forward svc/mesh 8080:80
# then, in another shell:
curl -XPOST localhost:8080/mesh/refresh   # {"discovered":3}
open http://localhost:8080/mesh-ui        # the discovered catalog + Topics table (declared), with the
                                          # live Fleet plane merged in (observed) — services as they
                                          # register, heartbeat, and push traces to the mesh's collector
```

Each service's own Spec UI is reachable the same way
(`kubectl -n benzene-ts-mesh port-forward svc/orders 8081:80` → `http://localhost:8081/benzene/spec-ui`).

To run a single service without a cluster at all (e.g. to iterate on `domain.ts`):

```bash
MESH_SERVICE=shipping PORT=8092 npx tsx examples/k8s-mesh/src/index.ts
MESH_SERVICE=payments PORT=8091 DOWNSTREAM_MSG_URL=http://localhost:8092/benzene-message \
  npx tsx examples/k8s-mesh/src/index.ts
MESH_SERVICE=orders   PORT=8090 DOWNSTREAM_MSG_URL=http://localhost:8091/benzene-message \
  npx tsx examples/k8s-mesh/src/index.ts
curl -XPOST localhost:8090/orders -H 'content-type: application/json' \
     -d '{"customerId":"c1","sku":"espresso","quantity":2}'
```

## Run the workflows

**Actions → Mesh Example K8s Deploy → Run workflow.** No inputs, no credentials. It builds both images,
creates a `kind` cluster, loads the images, applies the manifests, waits for rollout, `POST`s
`/mesh/refresh` and asserts `{"discovered":3}`, then exercises the chain end to end (`POST /orders` and
asserts the order comes back `created`) — a real end-to-end proof of both the Kubernetes discovery path
and the service-to-service chain in CI, entirely on the `ubuntu-latest` runner.

## Deploy to AWS (EKS)

**Actions → Mesh Example K8s EKS Deploy → Run workflow.** The AWS leg of this example, using the same
credentials setup as `Mesh Example AWS Lambda Deploy` (the `test` GitHub Environment's
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, which additionally need EKS, EC2, and ECR permissions) and
the same per-account S3 state bucket (key `k8s-mesh/`). The workflow:

1. `terraform apply` on `deploy/` — an EKS cluster (`benzene-ts-k8smesh`) with one small managed node
   group on the account's default VPC, plus two ECR repositories. First-time cluster creation takes
   ~10–15 minutes.
2. builds the two images and pushes them to ECR, tagged with the commit SHA.
3. applies the **unchanged** `k8s/` manifests through the `deploy/eks` kustomize overlay, which swaps in
   the ECR images and turns the mesh's NodePort Service into an internet-facing **LoadBalancer** — and
   does the same for each `benzene`-labelled Service, so orders/payments/shipping are directly callable
   from the internet as well.
4. waits for the ELBs, `POST`s `/mesh/refresh`, asserts `{"discovered":3}`, and prints
   `http://<elb-hostname>/mesh-ui` (the catalog with the live Fleet plane merged in) plus each service's
   `http://<elb-hostname>/benzene/spec-ui` URL (all in the run summary).

Same dogfooding, different substrate: discovery is still `@benzenejs/mesh-discovery-kubernetes` listing
`benzene`-labelled Services via the cluster API — EKS needs no code or manifest changes, only images it
can pull and a route in.

**Costs & teardown:** an EKS control plane bills ~$0.10/hour plus two `t3.small` nodes and four classic
ELBs (mesh + the three services, one per LoadBalancer Service). Re-run the workflow with **destroy =
true** to tear it all down (it deletes the namespace first so Kubernetes releases the ELBs, then
`terraform destroy`). Note the services are exposed **unauthenticated** — fine for this throwaway demo,
not a pattern to copy for real workloads.

To deploy from a laptop instead of CI, run the same four steps by hand: `terraform apply` in `deploy/`,
push the images to the ECR repositories it outputs, `aws eks update-kubeconfig`, then `kustomize edit set
image` + `kubectl apply -k` in `deploy/eks` (the workflow is the reference script for the exact commands).

## Deliberate divergences from .NET K8sMesh

- **No payload-versioning demo.** .NET's `payment:take` hop demonstrates a v1 producer being upcast to a
  single v2 handler (`docs/specification/versioning.md`). That's an orthogonal spec feature, not needed to
  prove the Kubernetes discovery + chaining story this example exists for; leaving it out also keeps this
  example's domain-handler complexity matched to `examples/aws-lambda-mesh`'s own (see `src/domain.ts`'s
  header comment).
- **No OpenTelemetry wiring.** .NET's K8sMesh wires full OTel (traces + metrics over OTLP). This repo's
  own `examples/aws-lambda-mesh` doesn't wire it either (the dependent packages aren't part of that
  example's surface); this example follows the same precedent.
- **Two Dockerfiles, one npm package** rather than .NET's two `.csproj`s in separate `Service/`/`Mesh/`
  folders: this repo builds examples as ordinary npm workspace packages (see `examples/k8s-orders/` and
  `examples/aws-lambda-mesh/`, each one package with multiple entry-point scripts), so
  `Dockerfile.service`/`Dockerfile.mesh` share one `package.json` and `src/` tree, differing only in which
  entry-point script their `CMD` runs.
- **An explicit `HttpEndpointDefinition` for each envelope-only endpoint.** `@benzenejs/express`'s
  `benzene()` middleware only hands a request to the Benzene pipeline when a registered HTTP-endpoint
  definition matches the method+path (the strangler-fig gate); `useBenzeneMessage`'s raw envelope endpoint
  and `useBenzeneCloudService`'s own `/benzene/invoke` don't register one, by design (they serve every
  topic, not one route per topic). `serviceApp.ts`/`meshApp.ts` each register a definition explicitly so
  Express routes matching POSTs through — see those files' comments. This is an example-level wiring
  detail, not a change to `@benzenejs/express`/`@benzenejs/http`/`@benzenejs/cloud-service`.
