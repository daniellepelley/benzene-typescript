# Multi-Tenancy

A multi-tenant B2B service handles requests for many customer organizations through one deployment, and
must attribute every request to a tenant and keep one tenant's data, cache, and side effects away from
another's. Benzene needs no heavyweight tenancy framework for this — it already has the exact seam:
**per-message DI scope with a small scoped holder**, the same pattern
[`AuthenticationHolder`](auth-patterns.md) uses. This cookbook shows the whole pattern end to end.

Benzene's job is to carry the *tenant context* through the pipeline. *Isolation* — a per-tenant cache-key
prefix, connection string, or `WHERE tenant_id = …` — is the application using that context. That split is
deliberate: the storage policy is yours, the plumbing is the framework's.

## Problem statement

Every request belongs to a tenant. You need to (1) resolve which tenant, from a trustworthy source; (2)
make that available to handlers and outbound calls without threading it through every method; (3) reject a
request that should be tenant-scoped but isn't; and (4) use it to isolate data and cache.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene pipeline (any transport).
- For the recommended claim strategy, an authenticated caller — see
  [Authentication Patterns](auth-patterns.md) (`@benzene/auth-oauth2` / `@benzene/auth-core`).

## Installation

```bash
npm install @benzene/core-middleware @benzene/results \
  @benzene/abstractions @benzene/abstractions-message-handlers \
  @benzene/abstractions-messages @benzene/abstractions-middleware
# for Strategy A (tenant from a validated JWT claim):
npm install @benzene/auth-core
```

Everything below is a page of code **you own** over a seam Benzene already has — there is no
`@benzene/multi-tenancy` package, because every team's isolation policy differs.

## Step 1 — the scoped tenant holder

A plain class, registered **scoped** (one per message), read wherever the tenant is needed. It is
deliberately **not** a property on `TContext`: a context type describes a transport message's shape, not
optional cross-cutting state (the port's "context purity" convention —
`src/Benzene.Abstractions.Middleware/CLAUDE.md`).

```ts
// tenant.ts
export class TenantHolder {
  /** The current message's tenant, or undefined if none was resolved. */
  tenantId: string | undefined;
}
```

## Step 2 — resolve the tenant into the holder

A resolver middleware runs early and sets `TenantHolder.tenantId`. Where the tenant comes from is a
strategy — pass it in as a delegate so the one middleware serves every source. This mirrors the auth
package's `requireRole` shape exactly (a free function taking the builder first, registering the holder,
then adding a `FuncWrapperMiddleware`):

```ts
// tenant.ts (continued)
import { IServiceResolver, tryAddScoped } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { FuncWrapperMiddleware } from '@benzene/core-middleware';

/** How to derive the tenant for a message — return undefined to leave the message untenanted. */
export type ResolveTenant<TContext> = (
  context: TContext,
  resolver: IServiceResolver,
) => string | undefined;

/**
 * Resolves the current message's tenant into a scoped TenantHolder using `resolveTenant`. Register it
 * early — after authentication (so a claim strategy can read the principal), before your handlers. The
 * `app.use((resolver) => ...)` factory hands each message its own scoped resolver, so the holder written
 * here is the one the handler later reads.
 */
export function useTenant<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  resolveTenant: ResolveTenant<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((x) => tryAddScoped(x, TenantHolder));

  return app.use(
    (resolver) =>
      new FuncWrapperMiddleware<TContext>('ResolveTenant', async (context, next) => {
        resolver.getService(TenantHolder).tenantId = resolveTenant(context, resolver);
        await next();
      }),
  );
}
```

### Strategy A — from the authenticated principal (recommended)

If the caller is authenticated (see [Authentication Patterns](auth-patterns.md)), the tenant is a claim on
the validated token — **tamper-proof**, because the caller can't forge a claim inside a signed JWT. This is
the strategy to prefer.

```ts
import { AuthenticationHolder } from '@benzene/auth-core';
import { useOAuth2Bearer } from '@benzene/auth-oauth2';
import { useTenant } from './tenant.js';

useApiGateway(app, (api) => {
  useOAuth2Bearer(api, oauth2Options); // sets AuthenticationHolder.principal
  useTenant(api, (_context, resolver) =>
    resolver.getService(AuthenticationHolder).principal?.findFirst('tid')?.value,
  );
  useMessageHandlers(api, GetOrdersHandler);
});
```

### Strategy B — from a message header (internal / service-to-service)

Transport-agnostic, via `IMessageHeadersGetter<TContext>`. Only trust a client-supplied header for
isolation when the caller is trusted (an internal service, or a gateway that already validated the tenant) —
see [Security notes](#security-notes).

```ts
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';

useTenant<MyContext>(api, (context, resolver) => {
  const headers = (
    resolver.getService(IMessageHeadersGetter) as unknown as IMessageHeadersGetter<MyContext>
  ).getHeaders(context);
  return headers['x-tenant-id'];
});
```

> `IMessageHeadersGetter` is registered under one shared token (the port's `<unknown>` precedent for an
> erased-generic service), so cast the resolved getter to your `TContext` — the same cast the auth and
> versioning code use.

### Strategy C — from the HTTP subdomain

`acme.api.example.com` → `acme`. On an HTTP transport the host is a header, so it reads through the same
`IMessageHeadersGetter`:

```ts
useTenant<MyContext>(api, (context, resolver) => {
  const headers = (
    resolver.getService(IMessageHeadersGetter) as unknown as IMessageHeadersGetter<MyContext>
  ).getHeaders(context);
  const host = headers['host'];
  const parts = host?.split('.') ?? [];
  return parts.length > 2 ? parts[0] : undefined;
});
```

## Step 3 — require a tenant where one is mandatory

Routes that must be tenant-scoped get a guard that short-circuits with `bad-request` when no tenant was
resolved — the same result-setter idiom the auth `require*` middleware uses (`AuthResults`), so it returns a
proper status on every transport rather than throwing:

```ts
// tenant.ts (continued)
import { IServiceResolver, tryAddScoped } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import {
  IMessageGetter,
  IMessageHandlerResultSetter,
} from '@benzene/abstractions-message-handlers';
import { FuncWrapperMiddleware } from '@benzene/core-middleware';
import { MessageHandlerDefinition, MessageHandlerResult } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';

export function requireTenant<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((x) => tryAddScoped(x, TenantHolder));

  return app.use(
    (resolver) =>
      new FuncWrapperMiddleware<TContext>('RequireTenant', async (context, next) => {
        const tenantId = resolver.getService(TenantHolder).tenantId;
        if (tenantId === undefined || tenantId === '') {
          await setBadRequest(resolver, context, 'Missing tenant');
          return; // short-circuit: the handler never runs
        }
        await next();
      }),
  );
}

function setBadRequest<TContext>(
  resolver: IServiceResolver,
  context: TContext,
  detail: string,
): Promise<void> {
  const resultSetter = resolver.getService(
    IMessageHandlerResultSetter,
  ) as unknown as IMessageHandlerResultSetter<TContext>;
  const messageGetter = resolver.getService(IMessageGetter) as unknown as IMessageGetter<TContext>;

  // No specific handler ran — report the real incoming topic with an empty definition (same idiom the
  // health-check and auth middleware use).
  return resultSetter.setResultAsync(
    context,
    new MessageHandlerResult(
      messageGetter.getTopic(context),
      MessageHandlerDefinition.empty(),
      BenzeneResult.badRequest(detail),
    ),
  );
}
```

> `FuncWrapperMiddleware` lives in `@benzene/core-middleware`; `MessageHandlerDefinition` and
> `MessageHandlerResult` in `@benzene/core-message-handlers`. `MessageHandlerResult(topic, definition,
> result)` and `MessageHandlerDefinition.empty()` are the port of C#'s three-arg `MessageHandlerResult`
> and `MessageHandlerDefinition.Empty()`.

Compose them in the pipeline — authenticate, resolve, require, then handle:

```ts
useApiGateway(app, (api) => {
  useOAuth2Bearer(api, oauth2Options);
  useTenant(api, (_ctx, r) => r.getService(AuthenticationHolder).principal?.findFirst('tid')?.value);
  requireTenant(api);
  useMessageHandlers(api, GetOrdersHandler);
});
```

## Step 4 — use the tenant to isolate

Inject `TenantHolder` wherever you need it — it's just a scoped service (a class, so it's both the token and
the type in `static inject`).

**Handler / data access** — filter every query by the tenant:

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { IOrderRepository } from './OrderRepository.js';
import { TenantHolder } from './tenant.js';

export class GetOrders {}
export class OrderList {
  orders: string[] = [];
}

@message('orders:list', { requestType: GetOrders, responseType: OrderList })
export class GetOrdersHandler implements IMessageHandler<GetOrders, OrderList> {
  static readonly inject = [TenantHolder, IOrderRepository] as const;

  constructor(
    private readonly tenant: TenantHolder,
    private readonly orders: IOrderRepository,
  ) {}

  async handleAsync(): Promise<IBenzeneResultOf<OrderList>> {
    const orders = await this.orders.forTenant(this.tenant.tenantId!).listAsync(); // never a cross-tenant read
    const list = new OrderList();
    list.orders = orders;
    return BenzeneResult.ok(list);
  }
}
```

**Cache** — prefix keys so tenants can't read each other's cached values (see [Caching](../caching.md)):

```ts
const key = `${this.tenant.tenantId}:orders:${customerId}`;
```

**Per-tenant connection string / database** — select the backing store from the tenant:

```ts
const connectionString = this.tenantConnectionMap.forTenant(this.tenant.tenantId!);
```

**Outbound propagation** — when this service calls another Benzene service, forward the tenant so the
downstream `useTenant` (Strategy B) picks it up. Pass it as a per-call header on `sendAsync`, exactly as
correlation/trace headers are forwarded (see [Correlation IDs](../correlation-ids.md)):

```ts
await sender.sendAsync('inventory:reserve', request, { 'x-tenant-id': this.tenant.tenantId! });
```

## Testing

`TenantHolder` is a plain scoped service, so a handler test constructs one with the tenant under test. To
test resolution + the guard, drive the middleware directly (as the auth tests do in
`test/Benzene.Core.Test/Auth/`): a strategy returning `undefined` makes `requireTenant` short-circuit with
`bad-request`; a present tenant reaches the handler.

```ts
import { describe, expect, it } from 'vitest';
import { GetOrdersHandler, OrderList } from '../src/GetOrdersHandler.js';
import { TenantHolder } from '../src/tenant.js';

describe('tenant-scoped handler', () => {
  it('reads only the current tenant', async () => {
    const tenant = new TenantHolder();
    tenant.tenantId = 'acme';
    const repo = {
      forTenant: (id: string) => ({ listAsync: () => Promise.resolve([`${id}-order-1`]) }),
    };

    const handler = new GetOrdersHandler(tenant, repo as never);
    const result = await handler.handleAsync();

    expect(result.isSuccessful).toBe(true);
    expect((result.payload as OrderList).orders).toEqual(['acme-order-1']);
  });
});
```

## Security notes

- **Prefer the claim strategy (A).** A tenant claim inside a validated JWT can't be forged; a plain
  `x-tenant-id` header can be set to anything by whoever sends the request. Only trust a header for
  isolation when the sender is trusted.
- **Never derive isolation from a value the client fully controls without checking it** against the
  authenticated caller. Reading tenant `acme` from a header and serving `acme`'s data to a caller who only
  owns `globex` is the classic multi-tenant data leak — cross-check the resolved tenant against the
  principal when both are available.
- **Fail closed.** `requireTenant` on every tenant-scoped route means a resolution bug becomes a
  `bad-request`, not an unscoped query returning another tenant's rows.

## Do you need a package?

No — this is code you own over a seam Benzene already has, and every team's isolation policy differs. If
several services in your estate would copy the `TenantHolder` + `useTenant` + `requireTenant` trio verbatim,
factor it into a small shared internal library; there's nothing Benzene-specific left to add once the holder
and the two middleware exist.

## Further reading

- [Authentication Patterns](auth-patterns.md) — the `AuthenticationHolder`/claim source for Strategy A, and
  the `require*` result-setter idiom `requireTenant` mirrors.
- [Middleware](../middleware.md) — pipeline ordering that puts resolution before the guard before the handler.
- [Caching](../caching.md) — per-tenant key prefixing for cache isolation.
- [Correlation IDs](../correlation-ids.md) — the header-forwarding pattern outbound propagation follows.
- [Message Results](../message-result.md) — the `bad-request` status the guard returns.
</content>
