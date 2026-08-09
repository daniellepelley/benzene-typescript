# Message Payload Versioning

Evolve a topic's payload without breaking existing producers. Benzene gives you two tools for this, and
they compose: **route to a version-specific handler**, or keep **one** handler and **cast** older payloads
up to it (with multi-step version chains composed for you).

The version is metadata, never part of the body — it travels in the `benzene-version` header (a message
attribute on SQS/SNS, a header on HTTP and the envelope). A message with **no** version is treated as the
topic's default. The language-neutral rules live in the
[versioning specification](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/versioning.md);
this cookbook is the TypeScript how-to.

> **Runnable, tested reference.** Everything here is demonstrated end to end in
> [`examples/versioning`](../../examples/versioning) — one BenzeneMessage service over the envelope
> transport, with a component test
> (`test/Benzene.Core.Test/Examples/VersioningExampleTest.test.ts`) that boots the real app and pushes
> requests through the front door with a `benzene-version` header. Read it alongside this page.

## When to use which

| | Mechanism A — handler-version dispatch | Mechanism B — transparent casting |
|---|---|---|
| **Shape** | Two versions are genuinely different logic | Newer versions mostly *add* fields |
| **You write** | One handler per version | One handler, on the newest schema |
| **The framework** | Routes by version to the right handler | Up/down-casts the payload around the handler |
| **Reach for it when** | v2 does something v1 doesn't | v2 is v1 plus a field, and you don't want to fork the handler |

You can use both in one service, on different topics — they don't interfere (a topic with no casters is
never cast; a topic with one handler is never version-routed).

## Prerequisites

- [Node.js 22+](https://nodejs.org/).
- A Benzene message pipeline. The examples below use the BenzeneMessage envelope transport
  (`@benzene/core-messages`), but the version signal is transport-neutral — the same handlers work on any
  transport that carries `benzene-version` as metadata.

## Installation

```bash
npm install @benzene/core-versioning @benzene/core-message-handlers @benzene/core-messages \
  @benzene/core-middleware @benzene/dependencies @benzene/results \
  @benzene/abstractions @benzene/abstractions-message-handlers @benzene/abstractions-messages
```

`@benzene/core-versioning` is only needed for Mechanism B (casting). Mechanism A is pure
`@benzene/core-message-handlers` — the `@message` decorator's `version` option and the router do it all.

## Mechanism A — route to a version-specific handler

Give each handler the same topic but a different `version`, via the `@message` decorator options. Each
version's request/response is its own class — constructor identity is what the router and serializer key
on.

```ts
// contracts/order.ts
export class CreateOrderV1 {
  customerName: string | undefined;
  quantity = 0;
}
export class OrderAcceptedV1 {
  orderId: string | undefined;
  handledBy: string | undefined;
}

// V2 split the single customer name into first/last and added a currency — a genuinely different shape,
// which is exactly when a second handler (rather than a caster) is the right tool.
export class CreateOrderV2 {
  firstName: string | undefined;
  lastName: string | undefined;
  quantity = 0;
  currency: string | undefined;
}
export class OrderAcceptedV2 {
  orderId: string | undefined;
  handledBy: string | undefined;
  currency: string | undefined;
}
```

```ts
// handlers/order.ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { CreateOrderV1, CreateOrderV2, OrderAcceptedV1, OrderAcceptedV2 } from '../contracts/order.js';

@message('order:create', { version: 'v1', requestType: CreateOrderV1, responseType: OrderAcceptedV1 })
export class CreateOrderV1Handler implements IMessageHandler<CreateOrderV1, OrderAcceptedV1> {
  handleAsync(request: CreateOrderV1): Promise<IBenzeneResultOf<OrderAcceptedV1>> {
    const accepted = new OrderAcceptedV1();
    accepted.orderId = 'order-1';
    accepted.handledBy = 'CreateOrderV1Handler';
    return Promise.resolve(BenzeneResult.ok(accepted));
  }
}

@message('order:create', { version: 'v2', requestType: CreateOrderV2, responseType: OrderAcceptedV2 })
export class CreateOrderV2Handler implements IMessageHandler<CreateOrderV2, OrderAcceptedV2> {
  handleAsync(request: CreateOrderV2): Promise<IBenzeneResultOf<OrderAcceptedV2>> {
    const accepted = new OrderAcceptedV2();
    accepted.orderId = 'order-1';
    accepted.handledBy = 'CreateOrderV2Handler';
    accepted.currency = request.currency;
    return Promise.resolve(BenzeneResult.ok(accepted));
  }
}
```

The router reads the incoming version with `IMessageVersionGetter<TContext>` (the default
`HeaderMessageVersionGetter` scans `benzene-version` → `version` → `x-version`) and hands it to the
`VersionSelector`. The selector returns the handler for the **exact** version if one exists, otherwise the
**highest** registered version. So:

- `benzene-version: v1` → the V1 handler.
- `benzene-version: v2` → the V2 handler.
- **no version** → the highest registered version (`v2`) — i.e. the newest handler is the topic's default.

That's all the wiring: register both handlers with `useMessageHandlers(pipeline, CreateOrderV1Handler,
CreateOrderV2Handler)` as usual. No caster config is involved.

> **Port note — reading the routing version off `benzene-version`.** The router picks a versioned handler
> from the topic's `version`, which the stock BenzeneMessage getter reads from a `version` header, whereas
> the spec's canonical version key is `benzene-version`. To make **both** mechanisms read the one header,
> the runnable example wraps the transport's `IMessageGetter` with a small `VersionAwareMessageGetter` that
> stamps the routing version from the resolved `IMessageVersionGetter` (see
> [`examples/versioning/src/versionAwareMessageGetter.ts`](../../examples/versioning/src/versionAwareMessageGetter.ts)).
> Copy that seam if you want handler dispatch to key off `benzene-version` too; if your producers already
> send a `version` header, you don't need it.

## Mechanism B — one handler, transparent casting (with chaining)

Keep a single handler on the newest schema and let Benzene cast older payloads up to it, and the response
back down to the caller's version.

Each version of the payload adds one field. The handler is written against the newest, and older producers
are up-cast to it before it runs:

```ts
// contracts/inventory.ts
export class InventoryAdjustmentV1 {
  sku: string | undefined;
  delta = 0;
  trace: string | undefined;
}
export class InventoryAdjustmentV2 {
  sku: string | undefined;
  delta = 0;
  trace: string | undefined;
  warehouseId: string | undefined; // introduced in V2
}
export class InventoryAdjustmentV3 {
  sku: string | undefined;
  delta = 0;
  trace: string | undefined;
  warehouseId: string | undefined;
  reason: string | undefined; // introduced in V3 — the version the handler is written against
}
```

The handler is **unversioned** (`@message(topic)` with no `version`) because the version axis is handled by
the casting pipeline, not by picking a handler — a V1 or V2 producer is cast to V3 before it runs, so the
handler only ever sees its own schema:

```ts
// handlers/inventory.ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { InventoryAdjustmentV3 } from '../contracts/inventory.js';

@message('inventory:adjust', { requestType: InventoryAdjustmentV3, responseType: InventoryAdjustmentV3 })
export class AdjustInventoryHandler
  implements IMessageHandler<InventoryAdjustmentV3, InventoryAdjustmentV3>
{
  handleAsync(request: InventoryAdjustmentV3): Promise<IBenzeneResultOf<InventoryAdjustmentV3>> {
    const response = new InventoryAdjustmentV3();
    response.sku = request.sku;
    response.delta = request.delta;
    response.warehouseId = request.warehouseId;
    response.reason = request.reason;
    // `trace` exists in every version, so a value written here survives the response downcast all the
    // way back to a V1 caller — proof both hops of the upcast ran.
    response.trace = `handled-on-v3;warehouse=${request.warehouseId};reason=${request.reason}`;
    return Promise.resolve(BenzeneResult.ok(response));
  }
}
```

### Declare the versions and the casters

`registerSchemaCastDefinitions` registers each `(from) => to` caster, and `registerPayloadSchemaVersions`
declares which versions may be cast from/to per topic — expanding the individual casters into the full set
**at startup**, composing multi-step chains where no direct caster exists. Declare only the **adjacent**
casters (V1⇄V2, V2⇄V3); a V1 payload for the V3 handler is composed **V1→V2→V3** (breadth-first), and its
response downcast **V3→V2→V1** — there is deliberately no direct V1⇄V3 caster:

```ts
// versioning.ts
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import {
  registerPayloadSchemaVersions,
  registerSchemaCastDefinitions,
} from '@benzene/core-versioning';
import {
  InventoryAdjustmentV1,
  InventoryAdjustmentV2,
  InventoryAdjustmentV3,
} from './contracts/inventory.js';

export function addInventoryVersioning(services: IBenzeneServiceContainer): void {
  registerSchemaCastDefinitions(services, (casters) =>
    casters
      // Upcasts — each seeds the field its version introduces.
      .add<InventoryAdjustmentV1, InventoryAdjustmentV2>(
        InventoryAdjustmentV1,
        InventoryAdjustmentV2,
        'inventory:adjust',
        'v1',
        'v2',
        (from) => {
          const to = new InventoryAdjustmentV2();
          to.sku = from.sku;
          to.delta = from.delta;
          to.trace = from.trace;
          to.warehouseId = 'wh-main'; // seed the field V2 introduced
          return to;
        },
      )
      .add<InventoryAdjustmentV2, InventoryAdjustmentV3>(
        InventoryAdjustmentV2,
        InventoryAdjustmentV3,
        'inventory:adjust',
        'v2',
        'v3',
        (from) => {
          const to = new InventoryAdjustmentV3();
          to.sku = from.sku;
          to.delta = from.delta;
          to.trace = from.trace;
          to.warehouseId = from.warehouseId;
          to.reason = 'unspecified'; // seed the field V3 introduced
          return to;
        },
      )
      // Downcasts — each drops the field its higher version added.
      .add<InventoryAdjustmentV3, InventoryAdjustmentV2>(
        InventoryAdjustmentV3,
        InventoryAdjustmentV2,
        'inventory:adjust',
        'v3',
        'v2',
        (from) => {
          const to = new InventoryAdjustmentV2();
          to.sku = from.sku;
          to.delta = from.delta;
          to.trace = from.trace;
          to.warehouseId = from.warehouseId;
          return to;
        },
      )
      .add<InventoryAdjustmentV2, InventoryAdjustmentV1>(
        InventoryAdjustmentV2,
        InventoryAdjustmentV1,
        'inventory:adjust',
        'v2',
        'v1',
        (from) => {
          const to = new InventoryAdjustmentV1();
          to.sku = from.sku;
          to.delta = from.delta;
          to.trace = from.trace;
          return to;
        },
      ),
  );

  registerPayloadSchemaVersions(services, [
    {
      topic: 'inventory:adjust',
      fromSchemas: ['v1', 'v2', 'v3'],
      toSchemas: ['v1', 'v2', 'v3'],
    },
  ]);
}
```

> **Port divergence — explicit downcasters.** The .NET `AddPayloadVersioning` auto-synthesises the
> field-drop downcasters from the declared upcasters (via a reflection + expression-tree auto-mapper).
> TypeScript has no runtime property reflection, so `@benzene/core-versioning` deliberately does **not**
> port the auto-mapper — casters are explicit `(from) => to` functions (idiomatic TS anyway). You therefore
> declare the adjacent **downcasters** too; the expander still **chains** them (V3→V2→V1), which is the
> mechanism that matters. This bend is recorded in
> [`src/Benzene.Core.Versioning/index.ts`](../../src/Benzene.Core.Versioning/index.ts).

### Wire the casting decorators

`usePayloadVersionCasting<TContext>(services)` wraps the request and response payload mappers with the
casting decorators. Call it **after** the transport's default mappers are registered (by
`useMessageHandlers` → `addContextItems`), so these overrides win:

```ts
usePayloadVersionCasting<BenzeneMessageContext>(container);
```

A topic with no registered casters, or a message that signals **no** version, passes straight through
unchanged — the handler's declared request type *is* the canonical/default version.

## Putting it together

The full composition root, booting the same way a deployed host would:

```ts
// startUp.ts
import { BenzeneMessageContext } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { usePayloadVersionCasting } from '@benzene/core-versioning';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { AdjustInventoryHandler } from './handlers/inventory.js';
import { CreateOrderV1Handler, CreateOrderV2Handler } from './handlers/order.js';
import { addInventoryVersioning } from './versioning.js';

export function buildApp() {
  const container = new DefaultBenzeneServiceContainer();

  addBenzene(container);
  addBenzeneMessage(container);
  addInventoryVersioning(container); // Mechanism B: casters + version set (validated at startup)

  const pipeline = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlers(
    pipeline,
    CreateOrderV1Handler, //   Mechanism A: two handlers, one topic
    CreateOrderV2Handler,
    AdjustInventoryHandler, // Mechanism B: one handler on the newest schema
  );

  // Apply the casting decorators AFTER the transport's default mappers, so they win.
  usePayloadVersionCasting<BenzeneMessageContext>(container);

  return {
    app: new BenzeneMessageApplication(pipeline.build()),
    resolverFactory: container.createServiceResolverFactory(),
  };
}
```

`registerPayloadSchemaVersions` expands and validates the caster graph **when `buildApp` runs** — a missing
conversion path surfaces then, at deploy time, not on the first message in production.

## Testing it

Boot the real app and set the version like any other header — a plain string. This mirrors
`test/Benzene.Core.Test/Examples/VersioningExampleTest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BenzeneMessageRequest } from '@benzene/core-messages';
import { BenzeneResultStatus } from '@benzene/results';
import { buildApp } from '../src/startUp.js';
import { InventoryAdjustmentV1 } from '../src/contracts/inventory.js';
import { OrderAcceptedV1 } from '../src/contracts/order.js';

function request(topic: string, body: unknown, version?: string): BenzeneMessageRequest {
  const req = new BenzeneMessageRequest();
  req.topic = topic;
  req.headers = version ? { 'benzene-version': version } : {};
  req.body = JSON.stringify(body);
  return req;
}

describe('message versioning', () => {
  it('routes a v1 request to the V1 handler (Mechanism A)', async () => {
    const { app, resolverFactory } = buildApp();

    const response = await app.handleAsync(
      request('order:create', { customerName: 'Jo', quantity: 3 }, 'v1'),
      resolverFactory,
    );

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect((JSON.parse(response.body) as OrderAcceptedV1).handledBy).toBe('CreateOrderV1Handler');
  });

  it('upcasts a V1 request V1→V2→V3 and downcasts the response V3→V2→V1 (Mechanism B)', async () => {
    const { app, resolverFactory } = buildApp();

    const response = await app.handleAsync(
      request('inventory:adjust', { sku: 'ABC', delta: 5 }, 'v1'),
      resolverFactory,
    );

    const v1 = JSON.parse(response.body) as InventoryAdjustmentV1;
    // `trace` survives the downcast, carrying the chain-seeded values back to the V1 caller.
    expect(v1.trace).toBe('handled-on-v3;warehouse=wh-main;reason=unspecified');
    // The response is V1-shaped: none of the keys the higher versions added leak through.
    expect(Object.keys(v1)).not.toContain('warehouseId');
    expect(Object.keys(v1)).not.toContain('reason');
  });
});
```

The full example test also covers the single-hop (V2), no-cast (V3), and no-version-bypass cases.

## Troubleshooting

- **A missing conversion path throws at startup.** That's by design — `registerPayloadSchemaVersions`
  expands the caster graph eagerly, so a version declared in `fromSchemas`/`toSchemas` with no reachable
  caster fails when you build the app, not on the first message. Add the adjacent caster the chain needs.
- **The handler sees a versioned payload it doesn't understand.** Check `usePayloadVersionCasting` is
  called **after** `useMessageHandlers` (the casting decorators must be the last-registered mappers to
  win), and that the topic appears in `registerPayloadSchemaVersions`.
- **Handler dispatch ignores `benzene-version`.** The stock BenzeneMessage getter reads the routing version
  from a `version` header. Either send that header, or add the `VersionAwareMessageGetter` seam from the
  example so dispatch reads `benzene-version`.
- **A no-version message isn't behaving like a default.** With no `benzene-version`, Mechanism A routes to
  the **highest** registered version, and Mechanism B **bypasses** casting (the body deserializes directly
  as the handler's own type). Both treat "no version" as "the newest/canonical shape".

## Further reading

- [`examples/versioning`](../../examples/versioning) — the runnable, tested worked example this page follows.
- [Versioning specification](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/versioning.md) — the language-neutral contract.
- [Message Handlers](../message-handlers.md) — the `@message` decorator, `IMessageHandler`, and routing.
- [Message Results](../message-result.md) — the `BenzeneResult` factory and statuses.
- [Serialization](../serialization.md) — how request/response payloads are (de)serialized around casting.
</content>
</invoke>
