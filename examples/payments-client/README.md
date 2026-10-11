# `@benzene-example/payments-client`

A **generated, topic-scoped TypeScript client for a real .NET service** — the "no .NET SDK required"
example for `@benzenejs/codegen-client`'s Contract Document input path
([contract-document.md](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/contract-document.md)).

`contracts/payments.spec.json` is the Contract Document of the .NET port's example payments service
(`benzene-dotnet/examples/AwsMesh/Orders/contracts/payments.spec.json`, emitted by `Benzene.Descriptor`)
— a service exposing `payments:capture` and `payments:get-all`, publishing the event `payment:captured`
and sending the command `shipping:book` (a `sends[]` entry: shipping owns that contract).

It is in the spec-0.3.0 shape (`schemaDialect`, `service`, `contractHash`/`registrationHash`, `sends`, no
reserved entries). The .NET example still emitted the earlier shape when this port moved, so the copy was
migrated mechanically from it — `openapi`/`info` replaced by `schemaDialect`/`service`, the reserved
`benzene:spec` entry and its two components dropped, the synthesized examples dropped, `shipping:book`
moved from `events` to `sends`, and both hashes computed — and goes back to being a verbatim copy once
the .NET port re-emits it.

`src/generated/` is the **committed output** of generating a
[topic-scoped client](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/contract-document.md#53-topic-scoped-schema-closure)
(contract-document.md §5.3) for `payments:capture` alone — nothing else on the document was consulted:
`payments:get-all` isn't generated.

## Regenerate

```bash
npm run generate -w @benzene-example/payments-client
```

Runs the `codegen-client` CLI (`@benzenejs/codegen-client`'s `bin`) exactly as committed:

```bash
codegen-client --file contracts/payments.spec.json --output topic-client \
  --namespace generated --service-name Payments --topics payments:capture --out src
```

`test/Benzene.Core.Test/CodeGen/PaymentsClientDogfoodTest.test.ts` regenerates the same client
in-process and asserts it matches `src/generated/PaymentsCapture/PaymentsCaptureServiceClient.ts`
byte-for-byte (the `GeneratedClientRoundTripTest.test.ts` pattern, applied to this input path), then:

- wires the committed client over a fake `IBenzeneMessageSender` and asserts calling
  `capturePaymentsAsync` sends topic `payments:capture` with the typed payload;
- asserts the client's embedded `contractHash` (contract-document.md §6) equals an independently
  computed hash of `payments:capture`'s topic-scoped projection (the test writes the projection out by
  hand and hashes it via `canonicalize` + `node:crypto` directly, rather than through
  `@benzenejs/codegen-core` — an independent check, not a tautology);
- asserts a `benzene:*` entry injected into the document is ignored by the parser and never generated.

## Why this document

Using an artifact from a *different port's* build - rather than a hand-written fixture - is the point:
it proves the TypeScript generator parses what `Benzene.Descriptor` emits (Swashbuckle's
`additionalProperties: false`, validation prose in `description`, `format: double`), not a shape this
repo's own author happened to write consistently with the parser.
