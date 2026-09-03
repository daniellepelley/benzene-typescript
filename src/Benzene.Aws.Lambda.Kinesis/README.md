# `@benzenejs/aws-lambda-kinesis`

Inbound AWS Kinesis Data Streams adapter for Benzene on Lambda: `useKinesis(app, action)` routes each
record of a Kinesis batch to a `@message` handler (records carry no topic, so pin one with
`usePresetTopic('<topic>')`), and reports a partial-batch resume point back to AWS.

```ts
useAwsLambda(app, (aws) =>
  useKinesis(aws, (kinesis) => {
    usePresetTopic(kinesis, 'order:created');
    useMessageHandlers(kinesis, OrderCreatedHandler);
  }),
);
```

## Configure `ReportBatchItemFailures` on the event source mapping

The handler's Lambda response is a `KinesisStreamBatchResponse` (`batchItemFailures`). AWS only reads
it when the event source mapping enables partial batch responses:

```
FunctionResponseTypes: [ReportBatchItemFailures]
```

(`--function-response-types ReportBatchItemFailures` on the CLI, `reportBatchItemFailures: true` in
CDK's `KinesisEventSource`.) Without it, AWS ignores the response body: a batch settles
whole-batch-on-success, and a failed record is only retried by failing the entire invocation.

## Failure model: checkpoint engine with a contiguous-prefix watermark

`KinesisApplication` carries the semantics of the C# checkpoint engine (.NET R17 #273):

- Records are grouped by **partition key**; each group runs **sequentially in shard order** and
  **stops at its first failure** (a thrown exception, a returned failure result, or a null/unrouted
  outcome — `isSuccessful !== true`). Groups run concurrently, preserving per-key ordering.
- Every successfully-handled record is confirmed on a checkpointer; the response reports the **first
  UNconfirmed record's sequence number** — the end of the longest contiguous confirmed prefix — as
  the single resume point. Kinesis's retry contract is not "skip the bad records": AWS reads only the
  first reported failure and redelivers **every** record from that sequence number to the end of the
  batch.
- The watermark never advances past an unconfirmed record: a still-failed record earlier in the batch
  is never silently reported as done just because a later record from a different partition key was
  confirmed first (the silent-skip bug a max-index watermark risks). The accepted tradeoff is safe
  **over-retry**: already-confirmed records sitting after the resume point are redelivered alongside
  the failed one — at-least-once, so keep handlers idempotent.
- A per-record exception is caught and logged, and the resume point is still returned — the resume
  point itself is the correct failure signal for Kinesis's shard-ordered retry contract (the .NET
  `CatchExceptions` default).

See `docs/capability-matrix.md` (settlement table) for how this compares with the other transports.

## Divergences from the C# package

The C# original is a streaming fan-in (`KinesisStreamApplication` over
`StreamContext<KinesisEventRecord>` / `UseStream`); the streaming engine is not yet ported, so this
package routes per record while porting the checkpoint engine's semantics into the application. The
application owns checkpointing (a success is confirmed automatically), so `KinesisStreamOptions`
(`AutoCheckpointOnSuccess`, `CatchExceptions` — knobs over handler-owned checkpointing) is not
ported. `KinesisEvent`/`KinesisEventRecord`/`KinesisRecordData` map to `@types/aws-lambda`'s
`KinesisStreamEvent`/`KinesisStreamRecord`, and `KinesisBatchResponse` to
`KinesisStreamBatchResponse`. See the barrel (`index.ts`) ADAPTATION note.
