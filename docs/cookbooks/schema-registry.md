# Register Kafka Payload Schemas with a Schema Registry

Give the topics your service publishes a central source of truth for their payload schema, frame each
message so any Confluent consumer can resolve the writer schema from its bytes, and fail a deploy the moment
a schema change would break the subject's compatibility rules.

## Problem statement

Your service publishes `OrderCreated` (and `OrderShipped`) to a Kafka topic that other services — possibly
non-Benzene, possibly in another language — consume. Without a shared schema source, a producer can quietly
change the shape of `OrderCreated` and every consumer starts failing at runtime, far from the change that
caused it. You want each type's schema registered centrally, the published bytes framed so any Confluent
consumer can resolve the writer schema, and a startup check that fails the deploy if a new schema breaks the
subject's compatibility rules.

This is the **applied** companion to the [Schema Registry reference](../schema-registry.md) — that page is
the type-by-type surface of `@benzene/schema-registry-core`; this one wires it into a service end to end.
Read them together.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene service — see [Getting Started](../getting-started.md).
- Familiarity with [Serialization](../serialization.md), especially `@benzene/avro`, since the registry
  frames Avro bytes rather than producing them.

## Installation

```bash
npm install @benzene/schema-registry-core @benzene/avro
```

`@benzene/schema-registry-core` is in-workspace and dependency-free — it adds the registry *framing* over
whatever inner serializer you give it. `@benzene/avro` produces the Avro bytes it frames (and takes
[`avsc`](https://www.npmjs.com/package/avsc) as its runtime dependency).

## Step 1 — the message types and their Avro schemas

Avro is schema-based, and TypeScript erases types at runtime, so each message **class** is associated with
an Avro schema explicitly via `registerAvroSchema` (the same class-keyed pattern the
[validation](../validation.md) adapters use — see
[Serialization](../serialization.md) for why reflection isn't available):

```ts
// messages.ts
export class OrderCreated {
  orderId?: string;
  amount?: number;
}
export class OrderShipped {
  orderId?: string;
  trackingNumber?: string;
}
```

```ts
// schemas.ts
import { registerAvroSchema } from '@benzene/avro';
import { OrderCreated, OrderShipped } from './messages.js';

export const orderCreatedSchema = {
  type: 'record',
  name: 'OrderCreated',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'amount', type: 'int' },
  ],
};

export const orderShippedSchema = {
  type: 'record',
  name: 'OrderShipped',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'trackingNumber', type: 'string' },
  ],
};

// Register each class's Avro schema so AvroSerializer can serialize instances of it.
registerAvroSchema(OrderCreated, orderCreatedSchema);
registerAvroSchema(OrderShipped, orderShippedSchema);
```

## Step 2 — tell the registrar how to find each type's schema

`ISchemaResolver` maps a message class to the `SchemaDefinition` (subject + schema **text** + format) to
register for it. The subject convention `<topic>-value` matches Confluent's default `TopicNameStrategy` for
a value schema. Use `DelegateSchemaResolver` for an inline mapping — it is the single place the Avro schema
objects and the registry meet, stringified into schema text:

```ts
// resolver.ts
import { DelegateSchemaResolver, SchemaDefinition, SchemaFormat } from '@benzene/schema-registry-core';
import { orderCreatedSchema, orderShippedSchema } from './schemas.js';

const schemaByName: Record<string, object> = {
  OrderCreated: orderCreatedSchema,
  OrderShipped: orderShippedSchema,
};

export const resolver = new DelegateSchemaResolver(
  (type) =>
    new SchemaDefinition(`${type.name}-value`, JSON.stringify(schemaByName[type.name]), SchemaFormat.Avro),
);
```

## Step 3 — register schemas and build the serializer at startup

Registration is asynchronous and belongs once, at startup — so a missing or incompatible schema surfaces at
boot, not on the first message. `SchemaRegistrar` does it up front and hands back a
`SchemaRegistrySerializer` whose `serialize` is synchronous (no registry call on the hot path). The
in-workspace `InMemorySchemaRegistryClient` is the shipped client (for tests, local dev, and single-node
use — for anything multi-node, back `ISchemaRegistryClient` with a real registry, see
[the reference](../schema-registry.md#remote-registry-clients)):

```ts
// serialization.ts
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import {
  addSchemaRegistry,
  ConfluentWireFormat,
  InMemorySchemaRegistryClient,
  SchemaCompatibilityMode,
  SchemaRegistrar,
} from '@benzene/schema-registry-core';
import { AvroSerializer } from '@benzene/avro';
import { OrderCreated, OrderShipped } from './messages.js';
import { resolver } from './resolver.js';
import './schemas.js'; // ensure the Avro schemas are registered

export async function configureSerialization(services: IBenzeneServiceContainer): Promise<void> {
  const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.Backward);
  const registrar = new SchemaRegistrar(registry, resolver);

  // Evolution gate: fail the deploy if any type's schema is no longer compatible (listing ALL breaks).
  await registrar.ensureCompatibleAsync([OrderCreated, OrderShipped]);

  // Register each schema and wrap AvroSerializer so its bytes are framed with the resolved schema id.
  const serializer = await registrar.createSerializerAsync(new AvroSerializer(), [
    OrderCreated,
    OrderShipped,
  ]);

  // The framed bytes are Confluent-wire-format: 0x00 magic byte | 4-byte BE schema id | Avro body.
  const framed = serializer.serializeToBytes(
    Object.assign(new OrderCreated(), { orderId: 'o1', amount: 42 }),
  );
  const { schemaId } = ConfluentWireFormat.decode(framed);
  console.log(`OrderCreated framed with schema id ${schemaId}`);

  // Make the client resolvable from the container by the ISchemaRegistryClient token.
  addSchemaRegistry(services, registry);
}
```

`SchemaRegistrar` has three members you'll use: `registerAsync(types)` (returns the resolved
`Constructor → id` map), `ensureCompatibleAsync(types)` (the evolution gate, throwing a single
`SchemaIncompatibleException` listing *all* incompatible subjects at once), and `createSerializerAsync(inner,
types)` (registers, then wraps `inner`).

Serializing a type whose schema you didn't register **throws immediately** — a missing registration is a
startup bug, not a silent runtime one.

## Step 4 — the wire format

`SchemaRegistrySerializer` does the framing for you, but the layout is the standard every Confluent
producer/consumer expects, and `ConfluentWireFormat` is exported for manual framing or interop tests:

```ts
import { ConfluentWireFormat } from '@benzene/schema-registry-core';

const framed = ConfluentWireFormat.encode(schemaId, bodyBytes); // 0x00 | id(4, BE) | body
const { schemaId: id, body } = ConfluentWireFormat.decode(framed);
```

A non-Benzene Kafka consumer resolves the writer schema from the embedded id — that interoperability is the
whole point of framing this way. `decode` throws if the buffer is shorter than the 5-byte header or doesn't
start with the magic byte.

## Compatibility modes and the in-box checker

`InMemorySchemaRegistryClient(mode?, checker?)` takes a `SchemaCompatibilityMode` (`None` / `Backward` /
`Forward` / `Full`, default `Backward`). Its default `TextualSchemaCompatibilityChecker` is deliberately
conservative: the first schema for a subject is always accepted, `None` accepts anything, and otherwise a
new version must be **textually identical** to the latest. So it never *falsely approves* a structural
change — but it also won't approve a genuinely backward-compatible one (say, adding an optional field with a
default). For true structural evolution, either register through a real registry server that computes
compatibility, or supply a format-aware `ISchemaCompatibilityChecker` — see
[the reference](../schema-registry.md#compatibility-checking).

## Testing

`InMemorySchemaRegistryClient` plus a trivial serializer exercise the whole path — id assignment, idempotent
registration, compatibility rejection, and the framing round-trip — with no registry server:

```ts
// schema-evolution.test.ts
import { describe, expect, it } from 'vitest';
import {
  InMemorySchemaRegistryClient,
  SchemaCompatibilityMode,
  SchemaDefinition,
  SchemaIncompatibleException,
} from '@benzene/schema-registry-core';

describe('order schema evolution', () => {
  it('assigns a stable id and dedups an identical re-registration', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.Backward);

    const id = await registry.registerAsync(new SchemaDefinition('orders-value', '{"v":1}'));
    const again = await registry.registerAsync(new SchemaDefinition('orders-value', '{"v":1}'));

    expect(again).toBe(id); // idempotent — same id, no new version
    expect((await registry.getLatestAsync('orders-value'))?.version).toBe(1);
  });

  it('rejects an incompatible change under Backward', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.Backward);
    await registry.registerAsync(new SchemaDefinition('orders-value', '{"v":1}'));

    await expect(
      registry.registerAsync(new SchemaDefinition('orders-value', '{"v":2}')),
    ).rejects.toBeInstanceOf(SchemaIncompatibleException);
  });
});
```

See `test/Benzene.Core.Test/SchemaRegistry/` for worked examples covering the registrar, the serializer's
framing round-trip, and the compatibility gate.

## How the pieces fit

- **Startup** — `SchemaRegistrar.ensureCompatibleAsync` fails the deploy if a schema is incompatible with
  the registry's rules; `SchemaRegistrar.createSerializerAsync` registers every type and builds the
  serializer.
- **Runtime** — `SchemaRegistrySerializer` frames each message with its schema id, so consumers resolve the
  exact writer schema and contract drift is impossible to miss.

This complements the [contract-testing](contract-testing.md) story: the schema registry stops a breaking
*wire* change at the producer, while the contract-drift check surfaces a provider whose *message contract*
has moved from what a consumer's client was built against.

## Troubleshooting

### `Error: No schema id is registered for '<Type>'`

You serialized a type you never passed to `SchemaRegistrar` (`createSerializerAsync` / `registerAsync`). Add
it to the type list at startup — a missing registration is meant to fail loudly at startup, not silently at
runtime.

### `registerAvroSchema(Type, schema)` won't accept my schema string

`registerAvroSchema` takes an avsc **schema object** (`{ type: 'record', ... }`) or a compiled `avro.Type`,
not a JSON string. Keep the schema as an object for `@benzene/avro`, and `JSON.stringify` it only where the
registry needs schema **text** (the `SchemaDefinition` in your resolver, step 2).

### A backward-compatible change is rejected

The in-box `TextualSchemaCompatibilityChecker` only accepts textually-identical schemas. Adding even an
optional field is a text change it rejects. Use a real registry server or a format-aware checker for true
structural evolution — see [Compatibility checking](../schema-registry.md#compatibility-checking).

## Further reading

- [Schema Registry (reference)](../schema-registry.md) — the full `@benzene/schema-registry-core` surface,
  remote-client adapters, and the compatibility seam.
- [Serialization](../serialization.md) — `@benzene/avro` and the payload formats the registry frames.
- [Contract Testing](contract-testing.md) — the runtime drift check and conformance probe this complements.
- [Message Results](../message-result.md) — the message envelope the framed payload rides in.
