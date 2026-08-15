# Deploying the AWS Lambda mesh to a real account

This Terraform stack turns the in-memory example into **real infrastructure**: the same seven functions
(`functions/`), the same topology, on real Lambda + SQS + SNS + EventBridge + S3. It mirrors .NET's
[`examples/AwsMesh/deploy`](https://github.com/daniellepelley/benzene-dotnet/tree/main/examples/AwsMesh/deploy),
adapted for the Node runtime (no custom bootstrap, no ADOT/X-Ray layer wiring).

## What it creates

| Resource | Purpose |
| --- | --- |
| 6 **service Lambdas** (`nodejs22.x`), each tagged `benzene=true` | orders / payments / shipping / inventory / notifications / analytics — discovered by tag |
| 1 **mesh Lambda** (untagged) | discovers, interrogates, aggregates the catalog to S3 |
| 2 **SQS queues** + event-source mappings | `payments:capture` (orders→payments), `shipping:book` (payments→shipping) |
| 1 **SNS topic** + 2 subscriptions | `order:placed` fan-out to inventory + notifications |
| 1 **EventBridge bus** + 2 rules + 5 targets | `payment:captured` → notifications/analytics; `shipment:dispatched` → inventory/notifications/analytics |
| 6 **HTTP APIs** | one per service; the load-bearing route is `POST /orders` (kicks off the cascade) |
| 1 **S3 bucket** | the discovered `registry.json` + the catalog (`manifest.json`, `services/*.json`, `topics.json`, `topology.json`, `asyncapi.json`) under the `mesh/` prefix |
| 1 **static catalog viewer** | `web/index.html`, uploaded to `mesh/index.html` and served via S3 static-website hosting — a self-contained page (services + health, topology graph, topic catalog) that reads the catalog JSON next to it |
| 1 **EventBridge schedule** | fires the mesh Lambda every minute (`var.aggregate_schedule`) to keep the catalog fresh |

Each producer is handed its downstream target as an environment variable (`PAYMENTS_QUEUE_URL`,
`ORDER_PLACED_TOPIC_ARN`, `EVENT_BUS_NAME`) — exactly the names `functions/shared.ts` reads from each
send's `targetEnvVar`. Consumers just receive.

## How the code is packaged

`npm run bundle` (esbuild) bundles each `functions/<name>.ts` into a single `artifacts/<name>.mjs`, zipped
to `artifacts/<name>.zip`. The AWS SDK v3 is marked **external** — the `nodejs22.x` runtime already ships
it — so each zip is ~60 KB and carries no `node_modules`. Because the bundles are tiny, Terraform uploads
the code **inline** (`filename`), unlike the .NET stack which must stage tens-of-MB publishes through S3.

## Deploy

### From GitHub Actions (recommended)

The **Mesh Example AWS Lambda Deploy** workflow
(`.github/workflows/mesh-example-aws-lambda-deploy.yml`) does the whole thing on a manual trigger,
mirroring .NET's *Mesh Example AWS Deploy*. It bundles the seven functions, keeps Terraform state in a
per-account S3 bucket (so it survives between runs), and applies the stack.

1. On the repo's **`test`** GitHub Environment (Settings → Environments → test), set
   `AWS_ACCESS_KEY_ID` (a Variable or Secret) and `AWS_SECRET_ACCESS_KEY` (a Secret) for an IAM
   principal that can manage Lambda, IAM, S3, SQS, SNS, API Gateway, and EventBridge.
2. Actions → **Mesh Example AWS Lambda Deploy** → *Run workflow*. Pick a `region`; leave `recreate`
   off for a normal deploy (tick it once to clean-slate after a failed run left partial resources).

The state bucket (`benzene-ts-mesh-tfstate-<account>`) is created on first run. The committed
`main.tf` carries **no** backend block, so local runs (below) use local state; CI drops in a
`backend.tf` and inits against S3. `adopt-existing.sh` (normal path) and `cleanup-all.sh` (recreate
path) make re-runs idempotent, exactly as the .NET workflow does.

### From your machine

```bash
# from examples/aws-lambda-mesh/deploy
export AWS_PROFILE=…              # or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
./deploy.sh                       # bundles + terraform init + apply (local state)
# AUTO_APPROVE=1 ./deploy.sh      # non-interactive
```

`deploy.sh` runs `npm run bundle` then `terraform apply`. Or do it by hand:

```bash
npm --prefix .. run bundle
terraform init
terraform apply
```

## Try it

```bash
# 1. Kick off the cascade
curl -X POST "$(terraform output -raw orders_url)" \
  -H 'content-type: application/json' -d '{"orderId":"o1"}'

# 2. The mesh aggregates on a schedule; or run a pass now:
aws lambda invoke --function-name "$(terraform output -raw mesh_function_name)" /dev/stdout

# 3. Open the catalog viewer in a browser (populated after the mesh's first pass)
terraform output -raw mesh_ui_url

# ...or read the catalog JSON directly
aws s3 cp "$(terraform output -raw catalog_manifest_uri)" -
aws s3 ls "s3://$(terraform output -raw artifact_bucket)/mesh/" --recursive
```

The cascade (`orders → payments → shipping` over SQS, plus the SNS + EventBridge fan-outs) runs
asynchronously across the real Lambdas; CloudWatch Logs for each function shows it being reached.

## Notes / divergences from the .NET stack

- **Node runtime, not custom.** `runtime = nodejs22.x`, `handler = index.handler`. .NET's `provided.al2023`
  + `bootstrap` and its cold-start memory tuning don't apply.
- **No observability layer.** The .NET stack attaches the ADOT collector layer, X-Ray active tracing, and a
  CloudWatch EMF usage feed. Those depend on Benzene packages not part of this TypeScript example, so they're
  omitted — the topology and the discover→aggregate story are intact without them.
- **The mesh has no HTTP API; the UI is a static page, not a Lambda.** The mesh handler returns a plain
  summary (discover → aggregate to S3), not an API-Gateway proxy response, so it's driven purely by the
  schedule (and on-demand `aws lambda invoke`). Instead of the .NET mesh's Lambda-served `@benzenejs/mesh-ui`
  (not ported), the catalog is browsed through `web/index.html` served as an S3 static site — a
  language-neutral page that reads the same `manifest.json`/`topics.json`/`topology.json`. (A static page
  serves every port equally, so a natural future home is the cross-language benzene spec repo.)
- **Inline code, no S3 code bucket.** Node bundles are tiny, so there's no `RequestEntityTooLarge` limit to
  work around; the S3 bucket here holds only the mesh's catalog artifacts.
- **No remote state backend.** This stack uses local state for simplicity. For CI/shared use, add a
  `backend "s3" {}` block and `terraform init -backend-config=…`, as the .NET example does.

## Tear down

```bash
terraform destroy
```

The S3 bucket is `force_destroy = true`, so it's emptied and removed with the rest of the stack.
