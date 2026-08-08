# Benzene starter templates

Vanilla, minimal starting points for a new Benzene TypeScript service — one per transport. This folder
is the TypeScript counterpart of the .NET port's top-level [`templates/`](https://github.com/daniellepelley/benzene-dotnet/tree/main/templates)
folder, and the sibling of the Go and Python ports' `templates/` folders. It is the **one home** for
starters across every language.

## Templates vs. examples — which do I want?

| | [`templates/`](.) (you are here) | [`examples/`](../examples) |
|---|---|---|
| **Purpose** | The **starting point** for a real service | **Learn a technique** — see one feature exercised |
| **Shape** | Vanilla and minimal — a composition root, one demo handler, the host entry, an optional test | Contrived and feature-rich — deliberately shows off gRPC, versioning, sagas, OpenTelemetry, mesh, … |
| **You do** | Scaffold it, then **write your handlers** — nothing to delete first | Read it, copy the technique into your own service |
| **Grows into** | Your production service | Nothing — it's a teaching artifact |

If the first thing you'd do with an "example" is start deleting its boilerplate, you wanted a template.
Keeping the two separate is deliberate: a template must stay boilerplate-free, and an example must stay
free to be as elaborate as the feature it teaches.

## The templates

| Template | Hosts |
|---|---|
| [`aws-apigateway`](aws-apigateway) | AWS Lambda + API Gateway (HTTP) — a request/response handler (`POST /hello` → topic `hello:world`), with a SAM `template.yaml` |
| [`aws-sqs`](aws-sqs) | AWS Lambda + SQS — a fire-and-forget queue consumer (topic `hello:world`) |

Each is a complete, minimal service: a `StartUp` composition root, a demo handler with one injected
service (`IGreeter`), the Lambda handler entry (`src/handler.ts`), and — unless you scaffold with
`--no-tests` — a `vitest` component test that boots the app and pushes a message through the real pipeline.

## Using them

Scaffold with `create-benzene` (the `npm create benzene` generator) rather than copying by hand — it
fills in the project name and prunes the test wiring on `--no-tests`:

```bash
# note the `--` so npm forwards flags to the generator
npm create benzene@latest my-svc -- --template aws-sqs
# equivalently, via npx (no `--` needed)
npx create-benzene my-svc --template aws-apigateway
```

See [`../create-benzene/README.md`](../create-benzene/README.md) for the full option list and design.

> **Heads-up:** a generated `package.json` references the **real** `@benzene/*` npm package names, which
> aren't published to the registry yet — so a fresh project resolves them from a local `benzene-typescript`
> workspace checkout for now (each template's own README explains how). A stated prerequisite, not a bug.

## For maintainers

These directories are the **canonical, single source** of the starters. `create-benzene` consumes them:
in a repo checkout it reads this folder directly (`../templates`), and at publish time its
`prepack`/`postpack` scripts copy this folder into the package tarball (npm can't ship files from outside
a package's own directory) and remove the copy afterwards. Edit the templates **here**, never in a bundled
copy under `create-benzene/templates/` (that path is a gitignored build artifact). The template component
tests are verified end-to-end — generated, typechecked, and run against the local packages — by
[`../create-benzene/scripts/verify.mjs`](../create-benzene/scripts/verify.mjs).
