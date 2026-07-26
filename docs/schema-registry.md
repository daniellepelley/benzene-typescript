# Schema Registry

Register a shared payload schema centrally so producers can't silently ship a breaking change and any
consumer can resolve the exact schema a message was written with.

## Overview

Event-driven services that share a Kafka topic (or any other broker) need a shared source of truth for
the payload schema on that topic. Without one, a producer can quietly change the shape of `OrderCreated`
and every consumer — including non-Benzene ones written in another language — starts failing at runtime,
far from the change that caused it. A **schema registry** (Confluent Schema Registry, Azure Schema
Registry, AWS Glue) is that source of truth: producers register the schema they write with, the registry
hands back a stable id, and each published message carries that id so a consumer can look up the exact
writer schema.

`@benzene/schema-registry-core` gives you three things:

- a provider-agnostic `ISchemaRegistryClient` seam, so registry-backed serialization and evolution
  checks aren't tied to one vendor;
- the Confluent wire-format codec (`ConfluentWireFormat`) that frames a payload with its schema id in the
  layout the wider Kafka ecosystem already understands;
- a serializer decorator (`SchemaRegistrySerializer`, built at startup by `SchemaRegistrar`) that
  registers each message type's schema and frames its output with the resolved id.

It complements [`@benzene/avro`](serialization.md), which serializes payloads against Avro schemas but
does not itself talk to a registry. The two layer cleanly: Avro produces the bytes, the schema-registry
serializer registers the schema and frames those bytes with the id.

> **Boundary.** The in-box `InMemorySchemaRegistryClient` is for tests, local development, and single-node
> use. Its default compatibility checker is deliberately conservative — it only accepts a schema that is
> *textually identical* to the subject's latest version (or the first version of a subject). True
> structural evolution (does an Avro/JSON change preserve read/write compatibility?) needs either a real
> registry server or your own `ISchemaCompatibilityChecker`. See
> [Compatibility checking](#compatibility-checking) below.

## Installation

```bash
npm install @benzene/schema-registry-core
```

Node 22+ is required. Everything in this package is in-workspace and dependency-free; you add a registry
SDK only when you write a remote client (see [Remote registry clients](#remote-registry-clients)).

## The abstraction

`ISchemaRegistryClient` is the neutral seam. Methods are camelCase and return `Promise`s; the C#
`CancellationToken` maps to an optional `AbortSignal`, per the
[porting conventions](../README.md#porting-conventions).

```ts
import { ISchemaRegistryClient, SchemaDefinition, RegisteredSchema } from '@benzene/schema-registry-core';

interface ISchemaRegistryClient {
  // Registers `schema` under its subject and returns a registry-wide id.
  // Registering an identical schema again returns the existing id (idempotent).
  registerAsync(schema: SchemaDefinition, cancellationToken?: AbortSignal): Promise<number>;

  // Look a schema up by its id, or by the latest version of a subject.
  getByIdAsync(id: number, cancellationToken?: AbortSignal): Promise<RegisteredSchema | undefined>;
  getLatestAsync(subject: string, cancellationToken?: AbortSignal): Promise<RegisteredSchema | undefined>;

  // Whether `schema` is compatible with the subject's existing versions under the configured mode.
  isCompatibleAsync(schema: SchemaDefinition, cancellationToken?: AbortSignal): Promise<boolean>;
}
```

`ISchemaRegistryClient` also carries a merged `ServiceToken`, so an app resolves the client from the
container by the interface.

A **subject** is the registry's namespace key. By Kafka convention it is `<topic>-value` for a message
value schema and `<topic>-key` for a key schema; that is the convention Confluent's default
`TopicNameStrategy` uses, and the one the examples below follow.

### The value types

| Type | Shape |
| --- | --- |
| `SchemaDefinition` | `new SchemaDefinition(subject, schema, format?)` — what you register or check. `schema` is the schema text (e.g. an Avro `.avsc` document); `format` defaults to `SchemaFormat.Avro`. |
| `RegisteredSchema` | `{ id, subject, version, schema, format }` — a schema as stored: its registry-wide `id` (what the wire format embeds) plus its 1-based per-subject `version`. |
| `SchemaFormat` | `enum { Avro, Json, Protobuf }`. |
| `SchemaCompatibilityMode` | `enum { None, Backward, Forward, Full }` — the standard registry compatibility levels. |
| `SchemaIncompatibleException` | An `Error` subclass carrying the offending `subject`. |

## Registering schemas

`InMemorySchemaRegistryClient` is the shipped implementation. It assigns monotonic ids, versions each
subject, dedups an identical re-registration, and enforces compatibility via a pluggable checker.

```ts
import {
  InMemorySchemaRegistryClient,
  SchemaCompatibilityMode,
  SchemaDefinition,
  SchemaFormat,
} from '@benzene/schema-registry-core';

const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.Backward);

const id = await registry.registerAsync(
  new SchemaDefinition('orders-value', orderCreatedAvsc, SchemaFormat.Avro),
);
// id === 1 (first schema for the subject)

// Registering the identical schema again is idempotent — same id, no new version.
const again = await registry.registerAsync(
  new SchemaDefinition('orders-value', orderCreatedAvsc, SchemaFormat.Avro),
);
// again === id

const latest = await registry.getLatestAsync('orders-value');
// latest.version === 1, latest.id === id
```

State lives in this process only — the in-memory client does not coordinate ids across instances, which
is exactly why it is scoped to tests, local dev, and single-node use. For anything multi-node, back
`ISchemaRegistryClient` with a real registry server (see [Remote registry clients](#remote-registry-clients)).

The constructor takes the compatibility mode (default `Backward`) and, optionally, a custom
`ISchemaCompatibilityChecker` (default `TextualSchemaCompatibilityChecker`):

```ts
new InMemorySchemaRegistryClient(mode?: SchemaCompatibilityMode, checker?: ISchemaCompatibilityChecker)
```

## Resolving a schema per message type

`ISchemaResolver` maps a message **class** to the `SchemaDefinition` to register for it. Keeping this a
seam means the schema source stays pluggable and format-specific — an adapter over `@benzene/avro`'s
schema source can supply the Avro schema without this package depending on Avro.

> Because TypeScript erases generic type arguments, the resolver keys on the message **class**
> (a `Constructor`) rather than a runtime `Type`, the same convention `@benzene/avro` and the
> [validation](validation.md) adapters use.

Use `DelegateSchemaResolver` for an inline mapping:

```ts
import { DelegateSchemaResolver, SchemaDefinition } from '@benzene/schema-registry-core';

const resolver = new DelegateSchemaResolver(
  (type) => new SchemaDefinition(`${type.name}-value`, schemaTextFor(type)),
);
```

For Avro payloads, wrap `@benzene/avro`'s schema source in an `ISchemaResolver` that returns the Avro
schema text under the `<type>-value` subject; the resolver is the single place the two packages meet.

## Wiring it up at startup with `SchemaRegistrar`

Registration is asynchronous and should happen once, at startup — before you wire the pipeline — so a
missing or incompatible schema surfaces at boot, not on the first message. `SchemaRegistrar` does that up
front and hands back a serializer whose `serialize` is synchronous (no registry call on the hot path):

```ts
import { SchemaRegistrar } from '@benzene/schema-registry-core';
import { AvroSerializer } from '@benzene/avro';

const registrar = new SchemaRegistrar(registry, resolver);

// Optional evolution gate: fail startup if any type's current schema is no longer compatible.
await registrar.ensureCompatibleAsync([OrderCreated, OrderShipped]);

// Register each type's schema and get a serializer that frames the inner bytes with the resolved id.
const serializer = await registrar.createSerializerAsync(
  new AvroSerializer(avroResolver),   // any inner IPayloadSerializer — Avro, JSON, MessagePack
  [OrderCreated, OrderShipped],
);
```

`SchemaRegistrar` has three members:

- `registerAsync(types)` — registers each type's schema and returns a
  `ReadonlyMap<Constructor, number>` of the resolved ids.
- `ensureCompatibleAsync(types)` — checks every type's current schema against the registry and throws a
  single `SchemaIncompatibleException` listing *all* incompatible subjects at once, so one deploy surfaces
  every break rather than failing on the first.
- `createSerializerAsync(inner, types)` — registers the types, then returns a `SchemaRegistrySerializer`
  wrapping `inner` with the resolved id map.

## The `SchemaRegistrySerializer`

`SchemaRegistrySerializer` is an `IPayloadSerializer`/`ISerializer` decorator. It does not add a *format*
— it adds the registry *framing* over whatever inner serializer you give it:

```ts
serializeToBytes<T>(payload: T): Uint8Array           // frames the inner body with the resolved id
deserializeFromBytes<T>(payload, targetType?): T | undefined  // strips the frame, defers to inner
serialize<T>(payload: T): string                      // Base64 of the framed bytes
deserialize<T>(payload, targetType?): T | undefined   // consumes that Base64
```

Schema ids are resolved once, at startup, into the id map the serializer is constructed with, so
serialization stays synchronous. The type key is recovered from the payload's `constructor` on the way
out; the deserialize path takes an optional `targetType` (the erased `T`) that is forwarded to the inner
serializer — Avro needs it, JSON does not. Like `@benzene/avro`, the string members Base64-armor the
framed bytes so the serializer also flows through string-body pipelines unchanged.

Serializing a type whose schema you didn't register **throws immediately** — a missing registration is a
startup bug, not a silent runtime one:

```ts
serializer.serializeToBytes(new UnregisteredType());
// Error: No schema id is registered for 'UnregisteredType'.
//        Register its schema at startup via SchemaRegistrar before serializing.
```

## The Confluent wire format

`ConfluentWireFormat` is the framing every Confluent Kafka producer, consumer, and Avro/JSON/Protobuf
deserializer expects: a `0x00` magic byte, the 4-byte big-endian schema id, then the serialized body.
Framing Benzene's payloads this way makes them interoperable with the wider Kafka ecosystem — a
non-Benzene consumer resolves the writer schema from the embedded id.

```ts
import { ConfluentWireFormat } from '@benzene/schema-registry-core';

const framed = ConfluentWireFormat.encode(schemaId, bodyBytes); // 0x00 | id(4, BE) | body
const { schemaId: id, body } = ConfluentWireFormat.decode(framed);
```

`decode` throws if the buffer is shorter than the 5-byte header (`ConfluentWireFormat.headerLength`) or
doesn't start with the magic byte. You rarely call these directly — `SchemaRegistrySerializer` does the
framing for you — but they're exported for manual framing or interop tests.

## Compatibility checking

`ISchemaCompatibilityChecker` decides whether a candidate schema may replace a subject's current latest
version, given a `SchemaCompatibilityMode`. It is a seam because a real structural check is
format-specific; a registry server usually owns it, and an in-process registry can be handed a smarter
checker than the default.

The shipped `TextualSchemaCompatibilityChecker` is intentionally conservative:

- the **first** schema for a subject is always compatible;
- `SchemaCompatibilityMode.None` accepts anything;
- otherwise the candidate must be **textually identical** to the latest version.

That means it will never *falsely approve* a structural change — but it also won't approve a genuinely
backward-compatible one (say, adding an optional field). For true evolution rules, either register through
a real registry server that computes compatibility, or supply a format-aware checker:

```ts
import { ISchemaCompatibilityChecker, InMemorySchemaRegistryClient, SchemaCompatibilityMode } from '@benzene/schema-registry-core';

class AvroCompatibilityChecker implements ISchemaCompatibilityChecker {
  isCompatible(latest, candidate, mode): boolean {
    if (latest === undefined || mode === SchemaCompatibilityMode.None) return true;
    // ... structural Avro reader/writer compatibility for the given mode ...
    return true;
  }
}

const registry = new InMemorySchemaRegistryClient(
  SchemaCompatibilityMode.Backward,
  new AvroCompatibilityChecker(),
);
```

When a registration (or `ensureCompatibleAsync`) fails the check, a `SchemaIncompatibleException` is
thrown carrying the offending `subject`, stopping the breaking contract change at the source rather than
at a downstream consumer.

## DI registration

`addSchemaRegistry` is the free function that registers a client in the container (the C# extension
method, ported to a free function taking the container first). It registers your `ISchemaRegistryClient`
as a singleton, resolvable by the `ISchemaRegistryClient` token:

```ts
import { addSchemaRegistry } from '@benzene/schema-registry-core';

addSchemaRegistry(services, registry);
```

There is no `useSchemaRegistry` pipeline middleware — the registry is consumed at startup (by
`SchemaRegistrar`) and through the serializer you build there, not as a per-message pipeline stage.

## Remote registry clients

The package ships only the in-memory client. There is **no** shipped Confluent, Azure, or AWS Glue
adapter — those would each pull in a vendor SDK, and the core stays dependency-free so you pull in only
the registry you actually run. To target a real registry, implement `ISchemaRegistryClient` against that
registry's Node SDK: map `registerAsync` to the SDK's register call, `isCompatibleAsync` to its
compatibility endpoint (letting the *server* own structural rules), and `getById`/`getLatest` to its
lookups.

Two things to keep in mind when writing one:

- **Confluent's own serializers already frame payloads.** If you serialize through Confluent's Avro
  serializer, it applies the wire format itself — use `ConfluentWireFormat` only when you're framing
  manually rather than through the vendor serializer.
- **Some registries use string ids.** Azure Schema Registry identifies schemas by a GUID; the Confluent
  wire format embeds a 4-byte integer id, so if you frame Azure-registered payloads you'll need your own
  id-to-schema mapping rather than the registry's native id.

## Testing

`InMemorySchemaRegistryClient` plus a trivial inner serializer exercise the whole path — id assignment,
idempotent registration, compatibility rejection, and the framing round-trip — with no registry server:

```ts
import { describe, expect, it } from 'vitest';
import {
  InMemorySchemaRegistryClient,
  SchemaCompatibilityMode,
  SchemaDefinition,
  SchemaIncompatibleException,
} from '@benzene/schema-registry-core';

describe('order schema evolution', () => {
  it('rejects an incompatible change under Backward', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.Backward);
    await registry.registerAsync(new SchemaDefinition('orders-value', '{"v":1}'));

    await expect(
      registry.registerAsync(new SchemaDefinition('orders-value', '{"v":2}')),
    ).rejects.toBeInstanceOf(SchemaIncompatibleException);
  });
});
```

See `test/Benzene.Core.Test/SchemaRegistry/` in the repository for worked examples covering the
registrar, the serializer's framing round-trip, and the compatibility gate.

## How the pieces fit

- **Startup** — `SchemaRegistrar.ensureCompatibleAsync` fails the deploy if a schema is incompatible with
  the registry's rules; `SchemaRegistrar.createSerializerAsync` registers every type and builds the
  serializer.
- **Runtime** — `SchemaRegistrySerializer` frames each message with its schema id, so consumers resolve
  the exact writer schema and contract drift is impossible to miss.

## See Also

- [Serialization](serialization.md) — payload formats, including Avro, that the registry frames
- [Message Results](message-result.md) — the message envelope the framed payload rides in
- [Message Handlers](message-handlers.md) — the components whose request/response types you register schemas for
- [Validation](validation.md) — the sibling "reject bad input at the boundary" concern, also keyed by request class
- [Porting conventions](../README.md#porting-conventions) — `CancellationToken` → `AbortSignal`, `Type` → `Constructor`, and the other mappings
