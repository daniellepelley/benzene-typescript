# Authentication Patterns

Add OAuth2 bearer token (JWT) validation or HTTP Basic authentication to a Benzene service that has no
security-terminating gateway in front of it, plus scope-, role-, policy-, and resource-based
authorization.

## Problem Statement

Most Benzene services run behind something that already handles authentication — API Gateway with a
Cognito/Lambda authorizer, an Azure Front Door with auth rules, a load balancer with OIDC. In that
setup Benzene shouldn't duplicate that work, and it doesn't: there's nothing to configure.

But not every deployment has that in front of it — a self-hosted Express worker, a Lambda exposed
directly, or a deployment where the gateway's auth story isn't wired up yet. For those, you need
authentication at the Benzene level itself, as opt-in middleware you add only where you need it.

This cookbook covers:

- **`@benzene/auth-oauth2`** — validating an inbound `Authorization: Bearer <token>` JWT against an
  identity provider's JWKS endpoint (`useOAuth2Bearer`), plus scope-based authorization (`requireScope`)
- **`@benzene/auth-basic`** — RFC 7617 username/password authentication (`useBasicAuth`)
- **`@benzene/auth-core`** — mechanism-agnostic role (`requireRole`), named-policy (`requirePolicy`),
  and resource-based (`requireAuthorization`) authorization over any authenticated caller

Benzene provides the authorization *enforcement* primitives and pluggable policy/resource seams, but
no built-in adapter for a specific external policy engine — see
[What This Doesn't Cover](#what-this-doesnt-cover).

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene service hosted behind an HTTP transport — the
  Express host (`@benzene/express`), AWS Lambda API Gateway (`@benzene/aws-lambda-api-gateway`), or the
  Azure Functions HTTP trigger (`@benzene/azure-function-http`). Every package here targets
  `TContext extends IHttpContext`, so it works on any of them the same way.
- For `@benzene/auth-oauth2`: an identity provider that exposes either full OIDC discovery (Auth0,
  Cognito, Azure AD, Okta all do) or a bare JWKS document.

## Installation

```bash
npm install @benzene/auth-oauth2
# or, for Basic auth
npm install @benzene/auth-basic
```

Both depend on `@benzene/auth-core` (the shared `ClaimsPrincipal`/authorization primitives), which npm
pulls in transitively. `@benzene/auth-oauth2` adapts [`jose`](https://github.com/panva/jose) — the
popular Node JWT/JWKS library — as its one runtime dependency (the analog of the .NET package's
`Microsoft.IdentityModel` stack), so the same middleware works identically behind Express, Lambda, or
Azure Functions. `@benzene/auth-basic` has no third-party dependency.

## How the middleware composes

Every `use*`/`require*` function here is ordinary Benzene pipeline middleware: a free function that
takes the HTTP builder as its first argument (the port-wide convention for downstream fluent
extensions — see [Middleware](../middleware.md)) and registers itself in front of your handlers.
Authentication runs first and sets the caller; authorization runs next and reads it. Wire them onto the
same builder you pass to `useMessageHandlers`, authentication before authorization before the handlers:

```ts
useApiGateway(app, (api) => {
  useOAuth2Bearer(api, oauth2Options); // 1. authenticate: sets the principal (or 401s)
  requireScope(api, 'orders:write');   // 2. authorize: reads the principal (or 401/403s)
  useMessageHandlers(api, CreateOrderHandler); // 3. the protected route(s)
});
```

The authenticated caller is handed from the authentication middleware to later steps through
`AuthenticationHolder` — a small scoped (per-message) DI holder carrying a `ClaimsPrincipal`, **not** a
property on the transport context. This is the port's "context purity" pattern: a `TContext` describes
the shape of a transport message and stays free of optional cross-cutting state, so a pipeline that
never adds an authentication middleware never even allocates a holder. `ClaimsPrincipal`,
`ClaimsIdentity`, `Claim`, and `ClaimTypes` are a minimal port of `System.Security.Claims` living in
`@benzene/auth-core` — the .NET auth stack carries the caller as a BCL `ClaimsPrincipal` every JWT
library already produces, and JavaScript has no such shared type, so the small slice the middleware
actually reads is ported rather than inventing a Benzene-specific principal.

## OAuth2 Bearer Token Validation

`useOAuth2Bearer` takes an `OAuth2BearerOptions` instance. Every field is deliberately required with no
permissive silent default — see [Why `validAlgorithms` has no default](#why-validalgorithms-has-no-default).

```ts
import { OAuth2BearerOptions, useOAuth2Bearer } from '@benzene/auth-oauth2';

const oauth2Options = new OAuth2BearerOptions();

// Full OIDC discovery - most identity providers expose this. Use jwksUri instead for one that only
// publishes a bare JWKS document (set exactly one of the two, never both).
oauth2Options.authority = 'https://your-tenant.auth0.com/.well-known/openid-configuration';

// Required, no default - an empty list would accept tokens from any issuer/audience.
oauth2Options.validIssuers = ['https://your-tenant.auth0.com/'];
oauth2Options.validAudiences = ['your-api-identifier'];

// Required, no default - see "Why validAlgorithms has no default" below.
oauth2Options.validAlgorithms = ['RS256'];

useApiGateway(app, (api) => {
  useOAuth2Bearer(api, oauth2Options);
  useMessageHandlers(api, CreateOrderHandler);
});
```

Requests without a valid bearer token — missing header, malformed, expired, bad signature, wrong
issuer/audience/algorithm — are short-circuited with the `unauthorized` status (mapped to HTTP 401 by
every Benzene HTTP transport — see the [status table](../message-result.md)). A successfully validated
token's claims become available to later middleware and handlers via
`AuthenticationHolder.principal`. Each JWT payload entry becomes a `Claim` (a JSON-array claim value
becomes one claim per element, so `scp`/`roles` arrays read element by element downstream).

`OAuth2BearerOptions` also carries two optional fields:

| Field | Default | Meaning |
|---|---|---|
| `clockToleranceSeconds` | `120` | Clock-skew tolerance applied to `exp`/`nbf` (the port of C#'s `ClockSkew` `TimeSpan`, in seconds to match jose). |
| `requireHttpsMetadata` | `true` | Whether the `authority`/`jwksUri` must be fetched over HTTPS. Set `false` **only** for local testing against a plain-HTTP fake JWKS endpoint — never in production. |

### Provider-specific examples

**Auth0:**

```ts
const options = new OAuth2BearerOptions();
options.authority = 'https://your-tenant.auth0.com/.well-known/openid-configuration';
options.validIssuers = ['https://your-tenant.auth0.com/'];
options.validAudiences = ['https://your-api-identifier'];
options.validAlgorithms = ['RS256'];
```

**AWS Cognito:**

```ts
const options = new OAuth2BearerOptions();
options.authority =
  'https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/openid-configuration';
options.validIssuers = ['https://cognito-idp.{region}.amazonaws.com/{userPoolId}'];
options.validAudiences = ['{appClientId}'];
options.validAlgorithms = ['RS256'];
```

**Azure AD:**

```ts
const options = new OAuth2BearerOptions();
options.authority = 'https://login.microsoftonline.com/{tenantId}/v2.0/.well-known/openid-configuration';
options.validIssuers = ['https://login.microsoftonline.com/{tenantId}/v2.0'];
options.validAudiences = ['{applicationIdUri or clientId}'];
options.validAlgorithms = ['RS256'];
```

Any OIDC-compliant provider works the same way — point `authority` at its discovery document (or set
`jwksUri` to a bare JWKS URL) and fill in the issuer/audience/algorithm your provider issues.

### Why `validAlgorithms` has no default

Every option above is required with no permissive fallback, but `validAlgorithms` specifically guards
against a well-known class of attack: "algorithm confusion" (RFC 8725 §3.1). If a validator trusted
whatever `alg` a token's own header claimed, an attacker could take a service's RSA *public* key
(routinely not secret) and use it as an HMAC *secret* to forge an `HS256`-signed token the validator
would accept as if it were one of the service's real `RS256` tokens. Requiring an explicit, non-empty
allowlist is what closes that off — `OAuth2BearerOptions.validate()` (called by `useOAuth2Bearer` at
wire-up) throws if `validAlgorithms`, `validIssuers`, or `validAudiences` is empty, or if `authority`
and `jwksUri` aren't set exactly one at a time, so a misconfigured pipeline fails at startup, not
silently on the first request.

## Basic Authentication

For a simpler gate than full OAuth2 — a single service account, an internal admin surface — implement
`IBasicAuthCredentialValidator` and pass it to `useBasicAuth`:

```ts
import { Claim, ClaimsIdentity, ClaimsPrincipal, ClaimTypes } from '@benzene/auth-core';
import { IBasicAuthCredentialValidator } from '@benzene/auth-basic';

export class ServiceAccountValidator implements IBasicAuthCredentialValidator {
  async validateAsync(username: string, password: string): Promise<ClaimsPrincipal | undefined> {
    const expectedPassword = process.env.SERVICE_ACCOUNT_PASSWORD;
    if (username !== 'service-account' || password !== expectedPassword) {
      return undefined; // C# `null` -> `undefined`: an ordinary Unauthorized, not an error to throw
    }

    const identity = new ClaimsIdentity([new Claim(ClaimTypes.name, username)], 'Basic');
    return new ClaimsPrincipal(identity);
  }
}
```

```ts
import { useBasicAuth } from '@benzene/auth-basic';

useApiGateway(app, (api) => {
  useBasicAuth(api, new ServiceAccountValidator()); // optional 3rd arg: realm, defaults to "Benzene"
  useMessageHandlers(api, AdminHandler);
});
```

`@benzene/auth-basic` ships no default `IBasicAuthCredentialValidator` on purpose — hardcoding a
credential store in the package would be a footgun waiting to be deployed. Implement it against whatever
your service actually uses: an environment variable for a single service account (above), a secrets
manager, a user table. Return `undefined` for bad credentials — never throw; that's an ordinary
`unauthorized`, not an application error.

A missing/malformed `Authorization: Basic` header or a validator returning `undefined` produces
`unauthorized` (401) with a `WWW-Authenticate: Basic realm="..."` challenge header, per RFC 7617 — this
is what makes browsers and HTTP clients that understand Basic auth actually prompt for credentials. The
middleware splits the decoded credentials on the **first** `:` only (RFC 7617 allows `:` inside the
password) and strictly validates the Base64 before decoding (Node's `Buffer.from(..., 'base64')`
silently drops invalid characters, so malformed input is rejected rather than mis-decoded).

## Scope-Based Authorization

Once a caller is authenticated via `useOAuth2Bearer`, require a scope before reaching a route:

```ts
import { requireScope, useOAuth2Bearer } from '@benzene/auth-oauth2';

useApiGateway(app, (api) => {
  useOAuth2Bearer(api, oauth2Options);
  requireScope(api, 'orders:write');
  useMessageHandlers(api, CreateOrderHandler);
});
```

`requireScope` reads both the `scope` claim (RFC 8693's convention — a single space-delimited string)
and the `scp` claim (Azure AD's convention — a space-delimited string *or* a JSON array, depending on
issuer) and normalizes them into one set, so it works the same regardless of which convention your
identity provider uses. Pass multiple scopes to require any one of them:

```ts
requireScope(api, 'orders:write', 'orders:admin'); // either scope is sufficient
```

Two distinct failure statuses matter here, and `requireScope` keeps them distinct on purpose:

| Situation | Status | Meaning |
|---|---|---|
| No `Authorization` header at all, or the token failed validation | `unauthorized` (401) | Caller not authenticated |
| A validly authenticated caller, but missing every required scope | `forbidden` (403) | Caller authenticated but not permitted |

Collapsing these into one status would leave an API consumer unable to tell "you're not logged in"
apart from "you're logged in but don't have permission" from the response code alone.

## Authorization: Roles, Policies & Resource Checks

Scopes are an OAuth2/JWT concept, so `requireScope` lives in `@benzene/auth-oauth2`. For authorization
that reads off any authenticated caller — regardless of whether the principal came from a bearer token,
Basic auth, or a custom mechanism — `@benzene/auth-core` adds three mechanism-agnostic checks. Benzene
owns the *enforcement* (each short-circuits with `unauthorized` when there's no caller and `forbidden`
when the caller lacks permission, the same distinction `requireScope` keeps); *what a role/policy means*
stays in your app.

All three compose the same way as `requireScope`, and on any transport (not just HTTP) whose pipeline
sets a principal.

### Roles — `requireRole`

```ts
import { requireRole } from '@benzene/auth-core';

requireRole(api, 'admin', 'operator'); // any one role is sufficient
```

Roles are read from the caller's `ClaimsPrincipal.isInRole` *and* the common role claim types
(`ClaimTypes.role`, `role`, `roles`), with the `roles` claim also accepted as a JSON array — Azure AD's
app-roles shape — so it works whether your issuer emits one claim per role or a single array.

### Named or inline policies — `requirePolicy`

A policy is a named rule over the principal. Define it inline, or register it once and reference it by
name:

```ts
import { addAuthorizationPolicy, requirePolicy } from '@benzene/auth-core';

// Inline (a sync or async predicate over the principal), named for the failure detail message:
requirePolicy(api, 'employees-only', (principal) => principal.hasClaim('department', 'engineering'));

// Or register once (in configureServices, or via api.register), reference by name from many pipelines:
const entryPoint = new InlineAwsLambdaStartUp()
  .configureServices((services) => {
    addAuthorizationPolicy(services, 'mfa-required', (principal) =>
      principal.hasClaim((c) => c.type === 'amr' && c.value === 'mfa'),
    );
  })
  .configure((app) =>
    useApiGateway(app, (api) => {
      useOAuth2Bearer(api, oauth2Options);
      requirePolicy(api, 'mfa-required'); // resolved from DI by name, per message
      useMessageHandlers(api, TransferFundsHandler);
    }),
  )
  .build();
```

For anything more involved than a predicate, implement `IAuthorizationPolicy` (a `name` plus
`isSatisfiedAsync(principal): Promise<boolean>`) and pass the instance to `requirePolicy(api, policy)`
or register it with `addAuthorizationPolicy(services, policy)`. The inline overloads are backed by
`DelegateAuthorizationPolicy`, which normalizes a sync-or-async predicate to a promise. A
`requirePolicy(api, name)` with no matching registered policy throws a teaching error at request time
naming the fix (register one with `addAuthorizationPolicy`).

### Resource-based checks — `requireAuthorization`

When the decision depends on *which* resource is being acted on (ownership, tenant match), implement
`IAuthorizationHandler<TResource>` and map the message to the resource it targets:

```ts
import { ClaimsPrincipal, IAuthorizationHandler, requireAuthorization } from '@benzene/auth-core';
import { ApiGatewayContext } from '@benzene/aws-lambda-api-gateway';

class OrderResource {
  constructor(readonly tenant: string) {}
}

class SameTenantHandler implements IAuthorizationHandler<OrderResource> {
  isAuthorizedAsync(principal: ClaimsPrincipal, resource: OrderResource): Promise<boolean> {
    return Promise.resolve(principal.hasClaim('tenant', resource.tenant));
  }
}

useApiGateway(app, (api) => {
  useOAuth2Bearer(api, oauth2Options);
  api.register((x) =>
    x.addScopedFactory(
      IAuthorizationHandler,
      () => new SameTenantHandler() as IAuthorizationHandler<unknown>,
    ),
  );
  // The resource is derived from the transport context (here, a query-string value).
  requireAuthorization(
    api,
    (context: ApiGatewayContext) =>
      new OrderResource(context.apiGatewayProxyRequest.queryStringParameters?.tenant ?? ''),
  );
  useMessageHandlers(api, GetOrderHandler);
});
```

Because C#'s open-generic registration (`AddScoped(typeof(IAuthorizationHandler<>), ...)`) has no
erased-generic equivalent in TypeScript, every resource handler registers under the one shared
`IAuthorizationHandler` service token (the `<unknown>` precedent used across the port), and
`requireAuthorization` casts the resolved handler back to its `TResource`.

The resource is derived from the transport **context** (topic, headers, a route/query value) because
authorization runs before the pipeline maps the request into a typed handler argument. When a decision
needs the fully-deserialized request, do that check inside the handler against the same
`AuthenticationHolder` principal instead.

## Protecting Only Some Routes

Every `use*`/`require*` call here is ordinary middleware — add it in front of the routes that need it,
not necessarily the whole pipeline. The straightforward way is to protect the entire pipeline (one
transport builder, authentication first, `useMessageHandlers` last) when every route in the service
needs it, exactly as the examples above do.

For a genuine mix of public and protected routes, the natural split differs by host:

**On the Express host**, `benzene(...)` is strangler-fig middleware: it only claims the method+path
combinations it has handlers for and calls Express `next()` for everything else. So two `benzene(...)`
mounts coexist cleanly — each builds its own DI container and only answers its own routes:

```ts
import express from 'express';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { benzene } from '@benzene/express';
import { useOAuth2Bearer, requireScope } from '@benzene/auth-oauth2';

const app = express();

// Public routes - no auth middleware.
app.use(benzene((pipeline) => useMessageHandlers(pipeline, PublicStatusHandler)));

// Protected routes - their own pipeline with auth in front, mounted under a URL prefix.
app.use(
  '/admin',
  benzene((pipeline) => {
    useOAuth2Bearer(pipeline, oauth2Options);
    requireScope(pipeline, 'admin');
    useMessageHandlers(pipeline, AdminHandler);
  }),
);

app.listen(3000);
```

**On AWS Lambda / Azure Functions**, the deployment boundary is the split: point each protected route
group at its own function with its own entry point and auth middleware, and leave public functions
without it. This is a wiring choice, not a rewrite — the same handlers move between grouped and
protected functions unchanged.

Either way, keep authentication and authorization on the *same* builder as the handlers they protect: a
short-circuiting middleware only guards steps registered after it on its own pipeline.

## Try It

The auth packages' own test suite is the best runnable reference for exactly this wiring without a real
identity provider. `test/Benzene.Core.Test/Auth/` drives `useOAuth2Bearer` and `requireScope` against a
locally-generated fake JWKS server (`FakeJwksServer.ts`, plain-HTTP loopback — hence
`requireHttpsMetadata = false`), through the API Gateway HTTP host, and asserts on the resulting 200 /
401 / 403 status codes:

```ts
import { describe, expect, it } from 'vitest';
import { OAuth2BearerOptions, requireScope, useOAuth2Bearer } from '@benzene/auth-oauth2';
import { createSecureEvent, runSecure } from './authHost';
import { FakeJwksServer, withJwks } from './FakeJwksServer';

describe('scope-protected route', () => {
  it('a valid token missing the scope is Forbidden, not Unauthorized', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const token = await FakeJwksServer.createToken(
        key,
        'kid1',
        'https://issuer.example.com',
        'my-api',
        { scope: 'read write' }, // authenticated, but no 'admin' scope
      );

      const options = new OAuth2BearerOptions();
      options.jwksUri = jwks.jwksUri;
      options.validIssuers = ['https://issuer.example.com'];
      options.validAudiences = ['my-api'];
      options.validAlgorithms = ['RS256'];
      options.requireHttpsMetadata = false;

      const response = await runSecure((api) => {
        useOAuth2Bearer(api, options);
        requireScope(api, 'admin');
      }, createSecureEvent(`Bearer ${token}`));

      expect(response.statusCode).toBe(403); // authenticated but not permitted
    });
  });
});
```

`test/Benzene.Core.Test/Auth/AuthorizationTest.test.ts` shows the same shape for `requireRole` /
`requirePolicy` / `requireAuthorization` (seeding a principal directly to exercise the authorization
primitives in isolation, plus one end-to-end case composing real `useBasicAuth` with `requireRole`).
See [Testing Benzene](../testing-benzene.md) for the full testing guide and
[Mocking External Dependencies](mocking-dependencies.md) for faking a validator or authorization
handler.

## Security Notes

- **Don't log the `Authorization` header.** It carries a bearer token or Basic credentials in the clear
  (base64 isn't encryption) — make sure any request-logging middleware you add redacts it.
- **Protect the framework's own surfaces if you have no gateway.** `/benzene/spec` (the derived spec)
  and the reserved `mesh` topic (the service descriptor) can leak schema/topology to an unauthenticated
  caller. If your service has no gateway in front of it, compose the same authentication middleware in
  front of those paths — they're ordinary HTTP routes/topics, so `useOAuth2Bearer`/`useBasicAuth` apply
  the same way.
- **`validAlgorithms` is not optional** — see
  [Why `validAlgorithms` has no default](#why-validalgorithms-has-no-default). Don't work around the
  wire-up error by passing every algorithm your provider might ever use; pass exactly the ones it
  actually signs with.
- **A failed OAuth2 validation never reveals why.** Bad signature, expired, wrong issuer — all of them
  produce the same generic `unauthorized` detail to the caller, because a distinguishable failure reason
  in the response is an oracle an attacker can use to probe token shapes. `useOAuth2Bearer` logs the
  real reason server-side (via the resolved `ILoggerFactory`, or `NullLogger` if none is registered); to
  debug a rejected token, check your service's logs, not the HTTP response.
- **Never set `requireHttpsMetadata = false` in production.** Fetching the JWKS (the document that
  establishes trust) over plain HTTP is vulnerable to a man-in-the-middle substituting a different
  signing key. It exists only for local testing against a plain-HTTP fake JWKS endpoint.

## What This Doesn't Cover

- **Integration with a specific external authorization-policy library or rules engine (OPA, Cedar,
  ASP.NET Core's `IAuthorizationService`).** Benzene provides the enforcement primitives —
  `requireRole`/`requirePolicy`/`requireAuthorization` — and the pluggable
  `IAuthorizationPolicy`/`IAuthorizationHandler<TResource>` seams to plug such an engine into, but ships
  no adapter for any particular one. What a policy *means* stays in your app.
- **Issuing or refreshing tokens, or driving an OAuth2 login/consent flow.** `@benzene/auth-oauth2` only
  validates inbound bearer tokens; it's not an OAuth2 client or authorization server.
- **mTLS, session/cookie authentication, or SOAP/WS-Security** — not addressed by this feature.

## Further Reading

- [useOAuth2Bearer](../common-middleware.md#useoauth2bearer),
  [useBasicAuth](../common-middleware.md#usebasicauth),
  [requireScope](../common-middleware.md#requirescope) in the Common Middleware reference.
- [Message Results](../message-result.md) — the `unauthorized`/`forbidden` status vocabulary these
  packages return through, and its transport (401/403) mapping.
- [Message Handlers](../message-handlers.md) — the `@message`/`@httpEndpoint` decorators and
  `IMessageHandler` the protected routes are built from.
- [Middleware](../middleware.md) — the pipeline ordering that puts authentication before authorization
  before the handler.
- [Mocking External Dependencies](mocking-dependencies.md) — faking a credential validator or
  authorization handler in vitest.
- [RFC 7617 (HTTP Basic)](https://www.rfc-editor.org/rfc/rfc7617),
  [RFC 8725 (JWT best practices)](https://www.rfc-editor.org/rfc/rfc8725) — the specs the two
  authentication middlewares implement.
