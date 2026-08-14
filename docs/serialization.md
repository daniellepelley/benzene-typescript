# Serialization & Media Formats

How a Benzene message's payload becomes bytes on the wire, and how you add and choose alternative formats.

## Overview

A Benzene message carries a `body` that must be serialized to send and deserialized to hand to a
[handler](message-handlers.md). The transport-neutral request/response mappers drive this: on the way in
the raw body is deserialized to the handler's request type, and on the way out the handler's result payload
is serialized back onto the response (see [Request mapping & content
negotiation](message-handlers.md#request-mapping--content-negotiation)).

Which serializer runs is decided **per request** by the media-format negotiator. Every transport registers
`addMediaFormatNegotiation`, which installs a `MediaFormatNegotiator<TContext>` seeded with the built-in
JSON format and any additional `IMediaFormat<TContext>` you register. For each message the negotiator:

- picks the **read** format from the request's `content-type` header, and
- picks the **write** format from the request's `accept` header (falling back to the read format, then to
  JSON).

**JSON is the default** — it ships in `@benzenejs/core-message-handlers` (`JsonMediaFormat` over `JsonSerializer`)
and is always present, so you never install anything to use it. When no header matches a registered format,
the negotiator falls back to JSON. Adding a format is opt-in: install its package and register it into a
pipeline, and content negotiation starts routing matching requests to it while everything else stays JSON.

Because a message's `status` is a plain string and the envelope is transport-neutral, the payload format is
negotiated independently of the status/HTTP mapping (see [Message Results](message-result.md)).

## The three adapter packages

Like the [validation adapters](validation.md), the alternative serializers are **adapters over popular
JavaScript libraries**, one package per library, each mirroring its .NET counterpart's shape. Each package
ships an `IMediaFormat<TContext>` (extending `AcceptHeaderMediaFormatBase`) plus an `ISerializer`, and a
pair of registration free functions (`add*` for a container, `use*` for a pipeline builder — C# extension
methods become free functions taking the builder first, per the [porting
conventions](../README.md#porting-conventions)).

| Package | Adapts (real dependency) | Content type | Register on a pipeline |
|---|---|---|---|
| [`@benzenejs/xml`](common-middleware.md#usexml) | [`fast-xml-parser`](https://www.npmjs.com/package/fast-xml-parser) | `application/xml` | `useXml(app)` |
| [`@benzenejs/messagepack`](common-middleware.md#usemessagepack) | [`@msgpack/msgpack`](https://www.npmjs.com/package/@msgpack/msgpack) | `application/msgpack` | `useMessagePack(app)` |
| `@benzenejs/avro` | [`avsc`](https://www.npmjs.com/package/avsc) | `application/avro` | `useAvro(app)` |

Each adapter takes its underlying library as a real runtime dependency — that is the whole point of an
adapter package. Install whichever you need:

```bash
npm install @benzenejs/xml          # over fast-xml-parser
# or
npm install @benzenejs/messagepack  # over @msgpack/msgpack
# or
npm install @benzenejs/avro         # over avsc
```

Prerequisite: Node 22+. You can install more than one and register them on the same pipeline — the
negotiator then picks whichever matches each request's headers, JSON included.

## XML — `@benzenejs/xml`

`@benzenejs/xml` adapts [`fast-xml-parser`](https://www.npmjs.com/package/fast-xml-parser). Registering it
adds `XmlMediaFormat<TContext>` (content type `application/xml`) alongside the default JSON format, so a
request whose `content-type` is `application/xml` is read as XML, and a request whose `accept` asks for
`application/xml` is written as XML.

Because `fast-xml-parser` is shape-based (not reflection-driven like .NET's
`System.Xml.Serialization.XmlSerializer`), `XmlSerializer` roots the document at the payload's runtime
`constructor.name` — so pass a class instance, as every Benzene message type is, to get a meaningful root
element. Element text is kept as strings so values round-trip faithfully (`'007'` stays `'007'`, not `7`).

```ts
import express from 'express';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { benzene } from '@benzenejs/express';
import { useXml } from '@benzenejs/xml';

class CreateOrder {
  orderId: string | undefined;
}
class OrderCreated {
  orderId: string | undefined;
}

@message('order:create', { requestType: CreateOrder, responseType: OrderCreated })
export class CreateOrderHandler implements IMessageHandler<CreateOrder, OrderCreated> {
  handleAsync(request: CreateOrder): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.orderId = request.orderId;
    return Promise.resolve(BenzeneResult.created(payload));
  }
}

const app = express();
app.use(
  benzene((pipeline) => {
    useXml(pipeline);                              // register the XML media format
    useMessageHandlers(pipeline, CreateOrderHandler);
  }),
);
app.listen(3000);
```

Now the same handler serves both formats. A request with `Content-Type: application/json` reads and writes
JSON (the default); a request with `Content-Type: application/xml` reads `<CreateOrder><orderId>…</orderId></CreateOrder>`
and, if it also sends `Accept: application/xml`, gets XML back. Nothing about the handler changes — content
negotiation is entirely at the media-format seam.

`useXml(pipeline)` calls `addXml` when the pipeline builds, which registers the shared `XmlSerializer` and
adds `XmlMediaFormat` as an `IMediaFormat`. See [Common Middleware →
useXml](common-middleware.md#usexml) for the signature.

## MessagePack — `@benzenejs/messagepack`

`@benzenejs/messagepack` adapts [`@msgpack/msgpack`](https://www.npmjs.com/package/@msgpack/msgpack).
Registering it adds `MessagePackMediaFormat<TContext>` (content type `application/msgpack`) alongside JSON,
negotiated the same way — `content-type`/`accept: application/msgpack`.

MessagePack is a genuinely **binary** format, but every Benzene transport carries its body as a `string`.
So `MessagePackSerializer` Base64-armors the MessagePack bytes on the string path (`serialize` produces
Base64 text, `deserialize` consumes it), letting binary MessagePack flow unchanged through the existing
string-bodied pipeline. A client sending or receiving MessagePack must Base64-decode/encode the body
accordingly. Like JSON — and unlike Avro — MessagePack is schemaless: any plain object serializes by its
own shape, so there is nothing to register per type.

```ts
import express from 'express';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { benzene } from '@benzenejs/express';
import { useMessagePack } from '@benzenejs/messagepack';
import { CreateOrderHandler } from './CreateOrderHandler.js';

const app = express();
app.use(
  benzene((pipeline) => {
    useMessagePack(pipeline);                      // register the MessagePack media format
    useMessageHandlers(pipeline, CreateOrderHandler);
  }),
);
app.listen(3000);
```

A request with `Content-Type: application/msgpack` and a Base64-encoded MessagePack body is now decoded to
`CreateOrder`; if it sends `Accept: application/msgpack`, the response payload comes back as Base64
MessagePack. See [Common Middleware → useMessagePack](common-middleware.md#usemessagepack) for the
signature.

## Avro — `@benzenejs/avro`

`@benzenejs/avro` adapts [`avsc`](https://www.npmjs.com/package/avsc). Registering it adds
`AvroMediaFormat<TContext>` (content type `application/avro`) alongside JSON. Avro is genuine binary too, so
`AvroSerializer` Base64-armors the bytes on the string path exactly like MessagePack.

### Avro requires a registered schema

Avro is **schema-based**: every serialized type needs an Avro schema. In .NET, `Benzene.Avro` can reflect
over a CLR type's properties to generate one. TypeScript erases types at runtime, so there is no reflection
fallback in the port — **you must register a schema for every message class Avro serializes.** An
unregistered type throws at (de)serialize time. This mirrors the way the [validation
adapters](validation.md#the-schema-registry) recover "which validator for `TRequest`" and the way
`@benzenejs/avro`'s registry is keyed by the message **class** rather than an erased type.

Register a schema on the process-wide global registry with `registerAvroSchema(MessageClass, schema)`,
passing either a compiled `avro.Type` or a plain Avro schema object (`{ type: 'record', … }`, compiled
lazily on first use). `getAvroSchema(MessageClass)` looks the compiled `avro.Type` back up.

```ts
import express from 'express';
import * as avro from 'avsc';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { benzene } from '@benzenejs/express';
import { registerAvroSchema, useAvro } from '@benzenejs/avro';
import { CreateOrder, OrderCreated, CreateOrderHandler } from './CreateOrderHandler.js';

// Every class Avro (de)serializes needs a registered schema — there is no reflection fallback.
registerAvroSchema(
  CreateOrder,
  { type: 'record', name: 'CreateOrder', fields: [{ name: 'orderId', type: 'string' }] },
);
registerAvroSchema(
  OrderCreated,
  avro.Type.forSchema({ type: 'record', name: 'OrderCreated', fields: [{ name: 'orderId', type: 'string' }] }),
);

const app = express();
app.use(
  benzene((pipeline) => {
    useAvro(pipeline);                             // register the Avro media format
    useMessageHandlers(pipeline, CreateOrderHandler);
  }),
);
app.listen(3000);
```

Instead of the global registry you can scope schemas to a single pipeline by passing a `configure` callback
to `useAvro` (or `addAvro`), which builds an `AvroOptions` whose `registerSchema` you call. An
options-scoped schema wins over a global one for the same class:

```ts
useAvro(pipeline, (options) => {
  options.registerSchema(CreateOrder, {
    type: 'record',
    name: 'CreateOrder',
    fields: [{ name: 'orderId', type: 'string' }],
  });
});
```

Schema resolution is done by `AvroSchemaResolver` (the default `IAvroSchemaResolver`), which checks the
options-scoped `AvroSchemaRegistry` first, then `AvroSchemaRegistry.global`, then throws with a message
telling you to register the schema. For tests, construct an isolated `AvroSchemaRegistry` instance so
registrations don't leak into global discovery.

Note that because the schema is keyed by class, deserializing bare Avro bytes needs the target class:
`AvroSerializer.deserialize(text, MessageClass)` / `deserializeFromBytes(bytes, MessageClass)`. Inside the
pipeline the request/response mappers supply that class from the handler's `@message` metadata, so you
rarely call the serializer directly.

> **Central schema registration.** To publish Avro schemas to a Confluent-style registry so other services
> (including non-Benzene ones) can resolve the exact writer schema, layer
> [`@benzenejs/schema-registry-core`](schema-registry.md) on top of `@benzenejs/avro` — it frames Avro bytes in
> the Confluent wire format and registers each type's schema under a subject.

## Troubleshooting

- **`No Avro schema is registered for 'X'`** — the class `X` was serialized without a schema. Register one
  with `registerAvroSchema(X, schema)` or `useAvro(app, (o) => o.registerSchema(X, schema))`. There is no
  reflection fallback in the port.
- **`AvroSerializer requires the target class to deserialize`** — you called `deserializeFromBytes(bytes)`
  without the message class. Avro needs the class to resolve the schema under type erasure; pass it:
  `deserializeFromBytes(bytes, X)`.
- **XML rooted at `<Object>`** — you serialized a plain object literal. `XmlSerializer` names the root after
  `constructor.name`; pass a class instance (as every Benzene message type is) or an explicit `rootName`.
- **Responses stay JSON even though the format is registered** — content negotiation reads the request's
  `accept` header for the write format and `content-type` for the read format. Send `Accept:
  application/xml` (or `application/msgpack` / `application/avro`) to get that format back; with no matching
  header the negotiator falls back to JSON.
- **Binary body looks like gibberish** — MessagePack and Avro bodies are Base64-armored to survive the
  string-bodied transports. Base64-decode the body before handing it to `@msgpack/msgpack` or `avsc`
  directly.

## See Also

- [Message Handlers](message-handlers.md#request-mapping--content-negotiation) — how the request/response
  mappers deserialize the body and pick a serializer per request.
- [Message Results](message-result.md) — the result envelope and status the payload rides alongside.
- [Common Middleware](common-middleware.md#usexml) — the `useXml` / `useMessagePack` reference entries.
- [Validation](validation.md) — the parallel adapter-per-library pattern for request validation.
- [Schema Registry Integration](schema-registry.md) — central schema registration for Avro payloads.
- [Porting conventions](../README.md#porting-conventions) — how the C# serializer shapes map to TypeScript.
