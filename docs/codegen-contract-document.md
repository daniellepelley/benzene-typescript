# Generating a client from a Contract Document

`@benzenejs/codegen-client` can generate a typed, topic-scoped TypeScript client from a **Contract
Document** — a service's committed `{Service}.spec.json` build artifact
([contract-document.md](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/contract-document.md)
in the cross-language spec repo). This is the file the .NET `Benzene.Descriptor` tool emits today, and
every language's generator parses the same way — so a Node consumer of **any** Benzene service,
including one written in .NET, Go, or Python, gets a fully typed client with no other language's SDK
involved.

This is a separate input path from `buildBenzeneClient`/`generateBenzeneClientSource` (which generate
from a *running* service's mesh ServiceDescriptor instead — see
[`examples/mesh-service`](https://github.com/daniellepelley/benzene-typescript/tree/main/examples/mesh-service)).
Use this page's path when you have a `.spec.json` file — typically checked into the producing service's
repo, or downloaded from its CI artifacts — rather than a live service to poll.

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
| `--include-reserved` | Also generate reserved Benzene utility topics (`benzene:spec`, `benzene:healthcheck`, …), which are excluded by default. Ignored once `--topics` names one explicitly — an explicit ask always wins. |
| `--out <dir>` | Where to write the generated file(s). Defaults to the current directory. |

The CLI exits non-zero (with a message on stderr) on an unknown flag, an unparseable/invalid document,
or an unknown `--topics` entry.

## Service-level vs. topic-scoped

- **`--output client`** (mirrors `buildMessageClientSdk`) generates one client covering every topic in
  scope — every domain topic by default, or exactly the `--topics` include-list. `events[]` and
  `components.schemas` pass through **unnarrowed**.
- **`--output topic-client`** (mirrors `buildAtomicClientSdk`) generates one **self-contained** client
  per in-scope topic: only that topic's own request/response interfaces, computed by walking
  `$ref`/`items`/`additionalProperties`/`properties`/`allOf`/`anyOf`/`oneOf` from its request and
  response schemas (contract-document.md §5.3 — cycle-safe, so a `$ref` cycle terminates cleanly). A
  consumer that only calls one topic gets a client whose `RequiredTopics` and embedded `contractHash`
  cover only that topic's contract — an unrelated change elsewhere on the producing service neither
  drags in unused surface nor invalidates the client.

Reserved Benzene utility topics (`benzene:` prefix, or an explicit `reserved: true` flag) are excluded
from the domain-only default in both shapes, per contract-document.md §5.1.

## The embedded `contractHash`

Every generated client carries a static `contractHash` — `"sha256:" + lowercase-hex(sha256(canonicalJSON(normalize(document))))`
(contract-document.md §6), computed over exactly the projection that client was generated from (the
whole document, the `--topics` projection, or a topic-scoped one). Compare it against the same
projection's hash served or recomputed by the producing service to detect drift between the client you
hold and the contract it was generated from — two different projections' hashes are never comparable to
each other (§6.4).

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
document; `applyTopicScope`/`buildMessageClientSdk`/`buildAtomicClientSdk` throw `UnknownTopicsError`
(carrying `.unknownTopics`/`.validTopics`) when `topics` names something the document doesn't have.

## A worked example

[`examples/payments-client`](https://github.com/daniellepelley/benzene-typescript/tree/main/examples/payments-client)
generates a `payments:capture` topic client from a **real, unedited** `.spec.json` copied from the .NET
port's own example service — proving this generator parses exactly what another language's tooling
actually emits, not a shape chosen to make the parser's life easy.
