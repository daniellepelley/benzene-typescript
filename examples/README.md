# Benzene examples

Contrived, feature-rich services that each **show off a technique** — how to do gRPC, message
versioning, sagas, OpenTelemetry tracing, a mesh, and so on. Read one to learn the technique, then copy
it into your own service.

> **These are not starting points.** An example deliberately carries boilerplate that exercises its
> feature — the first thing you'd do adopting one is delete most of it. To *start* a new service, scaffold
> a vanilla starter from [`../templates/`](../templates/README.md) (`npm create benzene`) and write your
> handlers into it. Templates are where you start; examples are where you learn a technique.

Each example is a workspace package under `@benzene-example/*`, written transport-agnostically (handlers
know nothing about what delivered the message), with a component test under
`test/Benzene.Core.Test/Examples/` that boots the real `StartUp` and drives it through the front door —
`k8s-orders` below is the one exception, since it's about deployment topology rather than a feature to
component-test, and each of its three entry points is exercised by actually running it (see its README).

| Example | Shows |
|---|---|
| [`aws-lambda-functions`](aws-lambda-functions) | One order domain hosted on **five** AWS Lambda transports at once |
| [`aws-lambda-mesh`](aws-lambda-mesh) | A Benzene **mesh** over AWS Lambda services (specs, topology, health) |
| [`azure-functions`](azure-functions) | Hosting the domain on **Azure Functions** |
| [`express-http`](express-http) | A standalone **Express** HTTP server (the non-Lambda hosting analog) |
| [`google-cloud-functions`](google-cloud-functions) | Hosting the domain on **Google Cloud Functions** |
| [`grpc`](grpc) | A **gRPC** greeter across all four RPC shapes, plus a client |
| [`k8s-orders`](k8s-orders) | One handler as **three independent Kubernetes Deployments** — HTTP, SQS, Kafka |
| [`kafka`](kafka) | A **Kafka** consumer worker + producer |
| [`mesh-service`](mesh-service) | A Benzene **mesh** service end to end |
| [`opentelemetry`](opentelemetry) | Pipeline tracing via `@benzene/diagnostics` spans |
| [`saga`](saga) | A distributed **saga** — signup with compensating rollback |
| [`versioning`](versioning) | Payload **versioning** — handler dispatch + payload casting off the `benzene-version` header |
