# Secrets & Configuration

Source your secrets (database passwords, API keys, signing keys) from a real secret store, validated at
startup so a missing credential fails fast, behind a one-method abstraction that doesn't hard-code a
single cloud.

## Problem Statement

Your service reads a database password and an API key. You want them:

- sourced from a real secret store in production (a mounted file, a cloud secret manager);
- overridable by environment variables locally, without touching code;
- validated at startup — not on the first request that happens to need them, deep inside a handler;
- read through code that doesn't change when you move from one backend (or cloud) to another; and
- read with types, so a malformed port number or endpoint URL fails with a clear error instead of a
  confusing one three call-frames away.

`@benzene/configuration-core` gives you all of this: a one-method `ISecretStore` seam, a set of
dependency-free providers (environment variables, mounted files, in-memory), composition, caching with
explicit invalidation, typed fail-fast resolution, and startup validation. The core package takes on **no
cloud-SDK dependency** — cloud stores (AWS Secrets Manager, Azure Key Vault) are a few-line custom
`ISecretStore` adapter you own, sketched at the end of this recipe. None ship in the port today.

## Prerequisites

- [Node.js 22+](https://nodejs.org/).
- A working handler and host, from [Getting Started](../getting-started.md).

## Installation

```bash
npm install @benzene/configuration-core
```

If you register the store into a Benzene container (Step 4), you already have `@benzene/abstractions` and
your host package from Getting Started; `@benzene/configuration-core` depends only on `@benzene/abstractions`.

## The abstraction

Everything in the package layers on a single method:

```ts
import { ISecretStore } from '@benzene/configuration-core';

interface ISecretStore {
  getSecretAsync(name: string, signal?: AbortSignal): Promise<string | undefined>;
}
```

A store returns the value for a logical name, or `undefined` when it doesn't have it — so a composite can
fall through to the next store. That's the whole contract, which is what makes a provider adapter trivial
to write and lets composition, caching, validation, and typed reads sit *on top* rather than being pushed
onto every adapter. Two porting notes: C#'s `CancellationToken` maps to an optional `AbortSignal`, and
`Task<string?>` maps to `Promise<string | undefined>` (C# `null` → `undefined`).

`ISecretStore` also carries a merged `ServiceToken` constant of the same name, so it's resolvable from a
Benzene container once registered.

## Step-by-Step Implementation

### 1. Pick your stores

Three providers ship, all runtime-only and usable without any cloud:

```ts
import {
  EnvironmentVariableSecretStore,
  FileSecretStore,
  InMemorySecretStore,
} from '@benzene/configuration-core';

// Twelve-factor: read from process.env. A logical name is upper-cased with ':', '.', '-' and spaces
// mapped to '_', plus an optional prefix — so 'Db:Password' with prefix 'MyApp_' reads MYAPP_DB_PASSWORD.
const envStore = new EnvironmentVariableSecretStore('MyApp_');

// Docker/Kubernetes secret mount: one file per secret. 'Db:Password' reads <dir>/Db_Password;
// a trailing newline is trimmed, a missing file resolves to undefined.
const fileStore = new FileSecretStore('/run/secrets');

// In-process map, for tests and local defaults. Accepts a Map or a plain object.
const localStore = new InMemorySecretStore({ 'Db:MaxConnections': '10' });
```

`EnvironmentVariableSecretStore` exposes its mapping as a static so you can check what a name resolves to:

```ts
EnvironmentVariableSecretStore.toEnvironmentVariableKey('Db:Password'); // 'DB_PASSWORD'
EnvironmentVariableSecretStore.toEnvironmentVariableKey('Api.Key');     // 'API_KEY'
```

### 2. Compose them, earliest wins

Layer an environment-variable override in front of your real store with `CompositeSecretStore`. It tries
each store in the order given and returns the **first non-`undefined`** value — so the earliest store in
the list wins, and later stores act as fall-through defaults:

```ts
import {
  CompositeSecretStore,
  CachingSecretStore,
  EnvironmentVariableSecretStore,
  FileSecretStore,
} from '@benzene/configuration-core';

const secrets = new CompositeSecretStore(
  new EnvironmentVariableSecretStore('MyApp_'), // 1. local/dev override, checked first
  new CachingSecretStore(                        // 2. the real store, cached (see Step 3)
    new FileSecretStore('/run/secrets')),
);
```

With this order, an environment variable always beats the mounted file — the natural local-development
override — and anything the env store doesn't have falls through to the file store. Put the fastest, most
specific store first and the broadest fallback last.

### 3. Cache the remote store

Wrap a store whose reads are expensive (a network call to a cloud secret manager) in `CachingSecretStore`
so it isn't hit on every read. A value is cached for a time-to-live (default **5 minutes**), and an absent
result is cached too, so a genuinely-missing name isn't re-queried on every read within the TTL:

```ts
import { CachingSecretStore } from '@benzene/configuration-core';

const cached = new CachingSecretStore(remoteStore, 10 * 60 * 1000); // 10-minute TTL
```

The constructor is `new CachingSecretStore(inner, timeToLiveMs?, now?)` — the third argument is an
injectable clock (`() => number`, default `Date.now`), which is what makes TTL behaviour testable without
waiting real time (see Testing).

When a secret is rotated and you can't wait out the TTL, force an immediate re-fetch:

```ts
cached.invalidate('Db:Password'); // drop one cached value
cached.invalidateAll();           // drop every cached value
```

### 4. Resolve values with `SecretResolver`

`SecretResolver` gives you ergonomic, typed, fail-fast reads over any `ISecretStore`. `requireAsync`
throws when a value is absent **or blank**; `getAsync` returns a default; the typed readers parse and
throw a clear error when a present value is malformed:

```ts
import { SecretResolver } from '@benzene/configuration-core';

const resolver = new SecretResolver(secrets);

const dbPassword = await resolver.requireAsync('Db:Password');        // string, throws if absent/blank
const apiKey     = await resolver.getAsync('Api:Key', 'dev-key');     // string | undefined, with a default
const maxConns   = await resolver.requireIntAsync('Db:MaxConnections'); // number, throws if not an integer
const debug      = await resolver.requireBoolAsync('Debug');          // boolean ('true'/'false')
const endpoint   = await resolver.requireUriAsync('Api:Endpoint');    // URL, throws if not absolute
```

`requireUriAsync` returns a WHATWG `URL` (the port of C#'s `Uri`); `requireIntAsync`/`requireBoolAsync`
throw a plain `Error` with a message naming the secret when the value is present but unparseable — the
port of C#'s `FormatException`, which has no JS equivalent.

Build a typed options object at startup and keep secrets there — never on a `TContext`, never in a log:

```ts
interface MyServiceOptions {
  dbPassword: string;
  apiKey: string;
  maxConnections: number;
  endpoint: URL;
}

const options: MyServiceOptions = {
  dbPassword: await resolver.requireAsync('Db:Password'),
  apiKey: await resolver.requireAsync('Api:Key'),
  maxConnections: await resolver.requireIntAsync('Db:MaxConnections'),
  endpoint: await resolver.requireUriAsync('Api:Endpoint'),
};
```

### 5. Validate everything at startup (fail fast)

Verify every required secret resolves *before* the service starts serving, so a misconfigured deployment
surfaces as one immediate, complete error listing everything that's wrong — not a redeploy per missing
credential, and not a first-request failure. `SecretValidation.ensureRequiredAsync` collects **all**
missing names and throws once:

```ts
import { SecretValidation } from '@benzene/configuration-core';

await SecretValidation.ensureRequiredAsync(secrets, 'Db:Password', 'Api:Key', 'Api:Endpoint');
// throws MissingSecretException listing every missing/blank name at once
```

`MissingSecretException` carries the full list on `missingNames`, so a caller can log or format it:

```ts
import { MissingSecretException } from '@benzene/configuration-core';

try {
  await SecretValidation.ensureRequiredAsync(secrets, 'Db:Password', 'Api:Key');
} catch (error) {
  if (error instanceof MissingSecretException) {
    console.error('Missing configuration:', error.missingNames.join(', '));
  }
  throw error; // let the process exit non-zero — do not start serving
}
```

### 6. Register the store in the container

If handlers need to resolve secrets on demand rather than reading everything into an options object at
startup, register the store with your Benzene container in `configureServices`. `addSecretStore` registers
both the `ISecretStore` and a `SecretResolver` over it as singletons:

```ts
import { addSecretStore } from '@benzene/configuration-core';

// inside .configureServices((services) => { ... })
addSecretStore(services, secrets);
```

Or compose and register in one call — `addSecretStores` builds an ordered `CompositeSecretStore`
(earliest-wins) for you:

```ts
import { addSecretStores } from '@benzene/configuration-core';

addSecretStores(services, envStore, cachedRemoteStore); // composite + resolver, registered
```

A handler then injects the resolver with the `static inject` convention (the resolver is registered under
the `SecretResolver` class itself, which acts as its own service identifier):

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { SecretResolver } from '@benzene/configuration-core';

@message('report:generate', { requestType: ReportRequest, responseType: ReportResult })
export class GenerateReportHandler implements IMessageHandler<ReportRequest, ReportResult> {
  static readonly inject = [SecretResolver] as const;

  constructor(private readonly secrets: SecretResolver) {}

  async handleAsync(request: ReportRequest): Promise<IBenzeneResultOf<ReportResult>> {
    const apiKey = await this.secrets.requireAsync('Api:Key');
    // ... use apiKey ...
    return BenzeneResult.ok(new ReportResult());
  }
}
```

Reading through a container-resolved `SecretResolver` gets you the caching and composition wired at
startup for free — the handler doesn't know or care which stores back it. See
[Message Handlers](../message-handlers.md) for the `static inject` convention.

## Testing

Everything in the core is dependency-free and unit-testable without a cloud. Use `InMemorySecretStore` for
seeded values, a plain fake `ISecretStore` for composition/validation wiring, and `CachingSecretStore`'s
injectable clock for TTL behaviour.

```ts
import { describe, expect, it } from 'vitest';
import {
  CachingSecretStore,
  CompositeSecretStore,
  InMemorySecretStore,
  ISecretStore,
  MissingSecretException,
  SecretResolver,
  SecretValidation,
} from '@benzene/configuration-core';

describe('secret configuration', () => {
  it('composite returns the value from the earliest store that has it', async () => {
    const secrets = new CompositeSecretStore(
      new InMemorySecretStore({ Shared: 'from-first' }),
      new InMemorySecretStore({ Shared: 'from-second', Only2: 'v2' }),
    );

    expect(await secrets.getSecretAsync('Shared')).toBe('from-first'); // earliest wins
    expect(await secrets.getSecretAsync('Only2')).toBe('v2');          // falls through
    expect(await secrets.getSecretAsync('Nowhere')).toBeUndefined();
  });

  it('requireAsync throws MissingSecretException when a secret is absent', async () => {
    const resolver = new SecretResolver(new InMemorySecretStore());

    await expect(resolver.requireAsync('Api:Key')).rejects.toBeInstanceOf(MissingSecretException);
  });

  it('ensureRequiredAsync lists every missing name at once', async () => {
    const store = new InMemorySecretStore({ Present: 'v' });

    await expect(
      SecretValidation.ensureRequiredAsync(store, 'Present', 'Missing1', 'Missing2'),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof MissingSecretException &&
        error.missingNames.includes('Missing1') &&
        error.missingNames.includes('Missing2') &&
        !error.missingNames.includes('Present'),
    );
  });

  it('caching serves within TTL and re-fetches after expiry or invalidate', async () => {
    let now = 1_000_000;
    let calls = 0;
    const inner: ISecretStore = {
      getSecretAsync: () => {
        calls++;
        return Promise.resolve('v');
      },
    };
    const cache = new CachingSecretStore(inner, 5 * 60 * 1000, () => now); // injected clock

    await cache.getSecretAsync('k');
    await cache.getSecretAsync('k');
    expect(calls).toBe(1); // second read served from cache

    now += 6 * 60 * 1000;  // advance past the TTL
    await cache.getSecretAsync('k');
    expect(calls).toBe(2); // re-fetched

    cache.invalidate('k');
    await cache.getSecretAsync('k');
    expect(calls).toBe(3); // forced re-fetch after invalidate
  });
});
```

The package's own suite —
`test/Benzene.Core.Test/Configuration/SecretStoresTest.test.ts` and
`SecretResolverAndValidationTest.test.ts` — covers every store and resolver path and is the best
reference for further cases (env-var mapping, file trailing-newline trimming, typed-read parse errors).

## Troubleshooting

### `MissingSecretException` at startup

That's the point: a required secret didn't resolve to a non-blank value from any store in the composite.
The message and `missingNames` list every name that failed. Check the env-var prefix and mapping
(`toEnvironmentVariableKey` shows exactly which variable a name reads), the file name in the mount
directory (`:`/`.`/`/`/`\` become `_`), and that the value isn't blank — `requireAsync` and
`ensureRequiredAsync` treat whitespace-only as missing.

### A stale value after rotating a secret

`CachingSecretStore` serves a cached value for its whole TTL (default 5 minutes). Shorten the TTL, or call
`invalidate(name)` / `invalidateAll()` when you know a rotation has happened. Remember an **absent** result
is cached too, so a name that didn't exist when first read stays `undefined` until the TTL lapses or you
invalidate it.

### `Secret '…' is not a valid integer` / `… boolean` / `… absolute URI`

The value resolved but the typed reader couldn't parse it. `requireIntAsync` accepts only an optional sign
and digits, `requireBoolAsync` only `true`/`false` (case-insensitive), and `requireUriAsync` requires an
**absolute** URL. Fix the stored value, or use `getAsync` and parse it yourself if the format is looser.

### The wrong store's value is winning

`CompositeSecretStore` is first-match / earliest-wins. If an environment variable is unexpectedly
overriding your real store, it's because the env store is earlier in the list — reorder the constructor
arguments so the store you want to win comes first.

## Variations

### A custom cloud `ISecretStore` (AWS Secrets Manager, Azure Key Vault)

No cloud adapter ships in the port — the core package stays dependency-free so you only pull in the SDK
for the cloud you actually use. A cloud store is a one-method class you own; return `undefined` on
not-found so a composite can fall through, and wrap it in `CachingSecretStore` so you're not calling the
cloud on every read. Sketch against the AWS Secrets Manager SDK (`@aws-sdk/client-secrets-manager`):

```ts
import { ISecretStore } from '@benzene/configuration-core';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';

export class SecretsManagerStore implements ISecretStore {
  constructor(private readonly client: SecretsManagerClient) {}

  async getSecretAsync(name: string, signal?: AbortSignal): Promise<string | undefined> {
    try {
      const response = await this.client.send(
        new GetSecretValueCommand({ SecretId: name }),
        { abortSignal: signal },
      );
      return response.SecretString;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return undefined; // not found -> let a CompositeSecretStore fall through
      }
      throw error;
    }
  }
}
```

An Azure Key Vault store follows the same shape over `@azure/keyvault-secrets` and `@azure/identity`
(catch a 404 `RestError` and return `undefined`; Key Vault names allow only `[0-9a-zA-Z-]`, so map `:`/`.`
in logical names to `-`). Prefer workload identity (an instance/task role, `DefaultAzureCredential`) over
a static bootstrap credential to reach the store — that removes the "secret to reach the secrets" problem.
Then compose exactly as in Step 2:

```ts
const secrets = new CompositeSecretStore(
  new EnvironmentVariableSecretStore('MyApp_'),
  new CachingSecretStore(new SecretsManagerStore(new SecretsManagerClient({}))),
);
```

### File-mounted secrets instead of environment variables

`FileSecretStore('/run/secrets')` reads Docker/Kubernetes secret mounts, one file per secret. Mounted
files keep credentials out of environment variables (which leak into child processes and crash dumps more
readily) and out of image layers — prefer them to env vars for the real backing store, keeping env vars as
the local override layer on top.

### Local defaults as a last-resort layer

Put an `InMemorySecretStore` last in the composite for non-secret defaults (a max-connections count, a
feature flag) so a fresh checkout runs without any configuration, while a real store or env var still
overrides each value when present.

## Security notes

- **Never log a resolved secret**, and never put one on a `TContext`. Resolve it at startup into typed
  options or a container-registered `SecretResolver`, and keep it there.
- **Fail fast, fail complete.** Run `SecretValidation.ensureRequiredAsync` before the pipeline serves
  traffic so one bad deploy is one clear error, not a slow trickle of first-request failures.
- **Prefer workload identity** over a static credential to reach a cloud secret store.

## Further Reading

- [Message Handlers](../message-handlers.md) — the `@message` decorator, `IMessageHandler`, and the
  `static inject` convention used to inject `SecretResolver`.
- [Bring Your Own DI Container](bring-your-own-di-container.md) — how `addSecretStore` registrations are
  resolved, service tokens, and `static inject` in depth.
- [Global Error Handling](global-error-handling.md) — catching a `MissingSecretException` (or any error)
  at the pipeline edge if a secret read fails at request time.
- [Validation](../validation.md) — validating request payloads (a different concern from validating
  configuration at startup).
- [Porting conventions](../../README.md#porting-conventions) — `Task<string?>` → `Promise<string | undefined>`,
  `CancellationToken` → `AbortSignal`, and the rest of the .NET → TypeScript mapping.
