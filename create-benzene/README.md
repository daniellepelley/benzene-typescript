# create-benzene

Scaffold a new [Benzene](https://github.com/daniellepelley/benzene-typescript) TypeScript service —
the `npm create benzene` project generator, the TypeScript-ecosystem counterpart of the .NET
`dotnet new benzene.*` template pack.

## Usage

```bash
# interactive (prompts for directory + template)
npm create benzene@latest

# non-interactive
npm create benzene@latest my-service -- --template aws-sqs
# equivalently
npx create-benzene my-service --template aws-apigateway
```

> When invoking via `npm create`, pass flags after `--` so npm forwards them to the generator:
> `npm create benzene@latest my-service -- --template aws-sqs`.

### Options

| Option | Description |
|---|---|
| `<project-directory>` | Directory to create the project in (also the default package name). |
| `-t, --template <id>` | Starter template (`aws-apigateway`, `aws-sqs`). Prompted for if omitted. |
| `--no-tests` | Skip the component-test project (drops `vitest` + the `@benzene/*-testing` devDeps). |
| `--overwrite` | Allow generating into a non-empty directory. |
| `-h, --help` | Show help. |

## Templates

Each template is a complete, minimal Benzene service — a `StartUp` composition root, a demo handler
with one injected service (a greeter), the Lambda handler entry (`src/handler.ts`), and (by default) a
`vitest` component test that boots the app via `benzeneTestHost(StartUp).buildAwsLambdaHost()` and
pushes a message through the real pipeline.

| Template | Transport | Demo handler |
|---|---|---|
| `aws-apigateway` | AWS Lambda + API Gateway (HTTP) | request/response (`POST /hello` → topic `hello:world`) |
| `aws-sqs` | AWS Lambda + SQS | fire-and-forget queue consumer (topic `hello:world`) |

## Published-vs-local packages

Generated projects reference the **real** `@benzene/*` npm package names at their published versions.
Until those packages are published to the npm registry, a generated project cannot `npm install` them
from the registry — resolve them from a local `benzene-typescript` workspace checkout instead (see each
template's own README). This is a stated prerequisite of the templates, not a bug in the generated code.

## Design

Follows the proven `create-vite` pattern: the starter templates are bundled as `templates/<id>/`
directories inside this package, and the CLI copies one, renaming the `__PROJECT_NAME__` token and
`_gitignore`, and writing a correct `package.json`. The CLI has **zero runtime dependencies** (Node
built-ins only), so `npm create benzene` runs with no install step.
