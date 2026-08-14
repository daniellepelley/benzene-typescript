# `@benzene-example/versioning`

One BenzeneMessage service dogfooding **both** of Benzene's payload-versioning axes
([spec](https://github.com/daniellepelley/Benzene/tree/main/docs/specification/versioning.md)). The
version always travels as the **`benzene-version`** metadata header — never inside the body — and a
message with no version signal is treated as the topic's default. Ported from the .NET
`Benzene.Examples.Versioning`.

## Mechanism A — handler-version dispatch (`order:create`)

Two genuinely different request shapes, two handlers, no casting: the incoming version picks the handler.

| Version | Handler | Request shape |
|---|---|---|
| `v1` | `CreateOrderV1MessageHandler` | flat `customerName` |
| `v2` | `CreateOrderV2MessageHandler` | `firstName`/`lastName` + `currency` |

Registered with `@message('order:create', { version: 'v1' })` / `{ version: 'v2' }`. When a producer sends
**no** version, the `VersionSelector` falls back to the highest registered version (`v2`) — so V2 is the
topic's default handler.

## Mechanism B — transparent payload casting with **caster chaining** (`inventory:adjust`)

Three payload versions of one type, but only **one** handler — written against the newest, V3. Older
producers are cast to V3 transparently, and the response cast back to the caller's version. The point is
**chaining**: only the *adjacent* casters are declared —

```
V1 ⇄ V2 ⇄ V3          (there is deliberately NO direct V1 ⇄ V3 caster)
```

— so a **V1** request is upcast by composing **V1→V2→V3**, and its response downcast **V3→V2→V1**.
`registerPayloadSchemaVersions` expands and composes the hops at startup.

Each version adds one field, seeded by the hop that introduces it:

| Version | Field it adds | Seeded by |
|---|---|---|
| V2 | `warehouseId` (`"wh-main"`) | the V1→V2 upcaster |
| V3 | `reason` (`"unspecified"`) | the V2→V3 upcaster |

The single V3 handler echoes both into a `trace` field present in every version, so it survives the
downcast — which is how a plain **V1** request/response proves *both* hops ran.

## Two port notes

- **Explicit downcasters.** .NET's `AddPayloadVersioning` auto-synthesises the field-drop downcasters from
  the declared upcasters (its reflection + `System.Linq.Expressions` auto-mapper).
  [`@benzenejs/core-versioning`](../../src/Benzene.Core.Versioning) deliberately does **not** port that
  auto-mapper (no runtime property reflection in TS), so casters are explicit `(from) => to` functions.
  [`src/startUp.ts`](src/startUp.ts) therefore declares the adjacent downcasters (V3→V2, V2→V1) too — the
  expander still **chains** them (V3→V2→V1), which is the mechanism the example is about.
- **One header for both axes.** The payload-casting version signal is the canonical `benzene-version`
  (`HeaderMessageVersionGetter`'s primary name), but the router picks a versioned handler from the topic's
  version, which the stock BenzeneMessage getter reads from a `version` header.
  [`src/versionAwareMessageGetter.ts`](src/versionAwareMessageGetter.ts) closes that gap in the composition
  root — it does exactly what `IMessageVersionGetter`'s contract calls for ("combine it with the topic into
  the version-aware dispatch key"), stamping the routing version from the resolved version getter so **both**
  axes read the one `benzene-version` header.

## Wiring — one place

[`src/startUp.ts`](src/startUp.ts) wires everything: register the three inventory versions and the four
adjacent casters, declare the schema-version set (which validates/expands the caster graph at startup — a
missing path would throw then, not on the first message), register the handlers, and apply the casting
decorators with `usePayloadVersionCasting` **after** the transport's default mappers so they win.

## Verify it

`test/Benzene.Core.Test/Examples/VersioningExampleTest.test.ts` boots the real app and pushes
`BenzeneMessageRequest`s through the front door with a `benzene-version` header, asserting handler dispatch
(v1/v2/default) and the full V1→V2→V3 up/down-cast round trip (plus the single-hop, no-cast, and
no-version-bypass cases). The handlers are transport-agnostic — the same versioning behaviour holds on any
transport that carries `benzene-version` as metadata (an attribute on SQS/SNS, a header on HTTP).
