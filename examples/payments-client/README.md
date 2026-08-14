# `@benzene-example/payments-client`

A **generated, topic-scoped TypeScript client for a real .NET service** — the "no .NET SDK required"
example for `@benzenejs/codegen-client`'s Contract Document input path
([contract-document.md](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/contract-document.md)).

`contracts/payments.spec.json` is a **verbatim copy** of a real `Benzene.Descriptor`-emitted Contract
Document from the .NET port
(`benzene-dotnet/examples/AwsMesh/Orders/contracts/payments.spec.json`) — a payments service exposing
`payments:capture`, `payments:get-all`, and (like every Cloud-Service-Profile service) the reserved
`benzene:spec` utility topic. `src/generated/` is the **committed output** of generating a
[topic-scoped client](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/contract-document.md#53-topic-scoped-schema-closure)
(contract-document.md §5.3) for `payments:capture` alone — nothing else on the document was consulted:
`payments:get-all` isn't generated, and the reserved `benzene:spec` topic isn't either.

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
  computed hash of `payments:capture`'s topic-scoped projection (the test computes this itself, via
  `canonicalize` + `node:crypto` directly, rather than through `@benzenejs/codegen-client`'s own
  `computeContractHash` — an independent check, not a tautology);
- asserts no `benzene:*` reserved topic appears anywhere in the generated source, even though the
  source document carries one (`benzene:spec`).

## Why this document, unmodified

Using a real, unedited artifact from a *different port's* build - rather than a hand-written fixture -
is the point: it proves the TypeScript generator parses exactly what `Benzene.Descriptor` actually
emits, not a shape this repo's own author happened to write consistently with the parser.
