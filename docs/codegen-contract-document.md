# Generating a client from a Contract Document

`@benzenejs/codegen-client` can generate a typed, topic-scoped TypeScript client from a **Contract
Document** — the document a service serves on `benzene:spec` / `GET /benzene/spec`, usually also committed
as a `{service}.spec.json` build artifact
([contract-document.md](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/contract-document.md)
in the cross-language spec repo). Every language's producer emits it and every language's generator
parses it the same way — so a Node consumer of **any** Benzene service,
including one written in .NET, Go, or Python, gets a fully typed client with no other language's SDK
involved.

The document can come from a `.spec.json` file — typically checked into the producing service's repo, or
downloaded from its CI artifacts — or live, from a running service's `GET /benzene/spec` (the same document it
registers with a mesh collector; see
[`examples/mesh-service`](https://github.com/daniellepelley/benzene-typescript/tree/main/examples/mesh-service)).
(The older generator over the mesh ServiceDescriptor, `buildBenzeneClient`, was removed with the descriptor
in spec-0.4.0.)

## Quick start

```bash
npx @benzenejs/codegen-client \
  --file payments.spec.json \
  --output topic-client \
  --namespace generated \
  --service-name Payments \
  --topics payments:capture
```

This writes `generated/PaymentsCapture/PaymentsCaptureServiceClient.ts` — a self-contained client for
just `payments:capture`: its own request/response interfaces (only the `components.schemas` entries
that topic's request/response actually reach), an `IPaymentsCaptureServiceClient` interface, a
`PaymentsCaptureServiceClient` class, a `PaymentsCaptureServiceClientRequiredTopics` constant, and an
`addPaymentsCaptureServiceClient` DI registration function.

```ts
import { addPaymentsCaptureServiceClient } from './generated/PaymentsCapture/PaymentsCaptureServiceClient';
import { addOutboundRouting } from '@benzenejs/clients';

addOutboundRouting(container, (routing) => routing.route('payments:capture', (pipeline) => useSqs(pipeline, queueUrl)));
addPaymentsCaptureServiceClient(container);
```

The generated class's only runtime dependency is `IBenzeneMessageSender` (`@benzenejs/clients`) — never a
transport-specific client. Which transport `payments:capture` actually goes over is your own outbound
routing configuration, wired separately (see [Clients](clients.md)); the generated client works
unmodified regardless.

## CLI flags

| Flag | Meaning |
| --- | --- |
| `--file <path>` | The Contract Document to read. Required. |
| `--output <client\|topic-client>` | `client` — one service-level client covering every in-scope topic. `topic-client` — one self-contained client **per** in-scope topic (contract-document.md §5.3). Required. |
| `--namespace <dir>` | Output directory the generated file(s) land under, used exactly. Required. |
| `--service-name <name>` | Names the service-level client's class/interface (`--output client`), or the aggregate registration for `--output topic-client`. |
| `--topics <a,b,c>` | Comma-separated topic include-list. Only these topics are generated. Naming a topic the document doesn't have **fails loud** — the error lists every valid topic id. |
| `--out <dir>` | Where to write the generated file(s). Defaults to the current directory. |

The CLI exits non-zero (with a message on stderr) on an unknown flag, an unparseable/invalid document
— including one whose `schemaDialect` isn't `openapi-3.0`, which the generator rejects rather than
guesses at — or an unknown `--topics` entry.

## Service-level vs. topic-scoped

- **`--output client`** (mirrors `buildMessageClientSdk`) generates one client covering every topic in
  scope — every topic in `requests[]` by default, or exactly the `--topics` include-list. `events[]`,
  `sends[]` and `components.schemas` pass through **unnarrowed**.
- **`--output topic-client`** (mirrors `buildAtomicClientSdk`) generates one **self-contained** client
  per in-scope topic: only that topic's own request/response interfaces, computed by walking
  `$ref`/`items`/`additionalProperties`/`properties`/`allOf`/`anyOf`/`oneOf` from its request and
  response schemas (contract-document.md §5.3 — cycle-safe, so a `$ref` cycle terminates cleanly). A
  consumer that only calls one topic gets a client whose `RequiredTopics` and embedded `contractHash`
  cover only that topic's contract — an unrelated change elsewhere on the producing service neither
  drags in unused surface nor invalidates the client.

A Contract Document never lists Benzene's own `benzene:` topics; if one turns up anyway, the parser
ignores it (contract-document.md §1, §5.1), so a generated client only ever covers the service's own
topics. A topic whose `response` is absent returns no payload, and its method is typed
`Promise<IBenzeneResultOf<void>>`.

## The embedded `contractHash`

Every generated client carries a static `contractHash` (contract-document.md §6): the SHA-256 of the
RFC 8785 canonical form of the document's `requests` and `events`, dereferenced and stripped of
documentation, so component names, entry order and schema descriptions never change it. It is
recomputed over exactly the projection that client was generated from — the whole document, the
`--topics` projection, or a topic-scoped one.

A **default** client (no `--topics`) embeds the same value the service serves as its own
`contractHash`, so drift detection is a string comparison: the producer's `addSchemaHealthCheck`
(`@benzenejs/health-checks-schema`) publishes the served value, and
`ClientHealthCheckProcessor` (`@benzenejs/clients-health-checks`) compares it with the client's. A
`--topics` or topic-scoped client must be compared with the same projection recomputed over the
provider's current document — two different projections' hashes are never comparable (§6.4).

The hash itself lives in `@benzenejs/codegen-core` (`ContractHash.compute(document)` returns both
`contractHash` and `registrationHash`), shared with the runtime that stamps them on the served document.

## Programmatic API

The CLI is a thin wrapper over the same functions it calls:

```ts
import {
  parseContractDocument,
  buildMessageClientSdk,
  buildAtomicClientSdk,
  computeContractHash,
} from '@benzenejs/codegen-client';
import { readFileSync } from 'node:fs';

const document = parseContractDocument(readFileSync('payments.spec.json', 'utf8'));

const [captureClient] = buildAtomicClientSdk(document, {
  namespace: 'generated',
  topics: ['payments:capture'],
});
console.log(captureClient.fileName, captureClient.source);
```

`parseContractDocument` throws `ContractDocumentParseError` on invalid JSON or a structurally invalid
document, and its subclass `UnknownSchemaDialectError` for a `schemaDialect` other than `openapi-3.0`; `applyTopicScope`/`buildMessageClientSdk`/`buildAtomicClientSdk` throw `UnknownTopicsError`
(carrying `.unknownTopics`/`.validTopics`) when `topics` names something the document doesn't have.

## A worked example

[`examples/payments-client`](https://github.com/daniellepelley/benzene-typescript/tree/main/examples/payments-client)
generates a `payments:capture` topic client from the `.spec.json` of the .NET port's own example
payments service — proving this generator reads what another language's tooling emits, not a shape
chosen to make the parser's life easy.
