/**
 * The SQS leg: a poller that shares the process `app.ts` starts, polling one queue and dispatching
 * every message to the same `PlaceOrderHandler` the HTTP leg exposes. `useSqs` wires the SQS message
 * getters and `useMessageHandlers` routes each poll batch to `PlaceOrderHandler` by its
 * `@message('order-place')` — the same handler import as every other leg, wired explicitly (this port
 * has no reflection-based handler discovery).
 *
 * Exports `buildSqsWorker()` only — see `app.ts` for how it's started (fire-and-forget, never awaited
 * inline: `startAsync` is this worker's own poll loop and does not resolve until stopped).
 */
import { SQSClient } from '@aws-sdk/client-sqs';
import { SqsClientFactory, useSqs } from '@benzene/aws-sqs';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineSelfHostedStartUp } from '@benzene/self-host';
import { PlaceOrderHandler } from './domain.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

const queueUrl = requireEnv('QUEUE_URL');

// A LocalStack/emulator endpoint is opt-in via SQS_ENDPOINT_URL (see compose/docker-compose.yml);
// unset (the real-AWS/EKS case), the SQSClient falls through to the SDK's default credential chain —
// an IRSA-mapped pod service account on EKS, same as every other Benzene AWS client. This worker never
// prescribes how you authenticate.
const sqsEndpointUrl = process.env['SQS_ENDPOINT_URL'];
const sqsClient = new SQSClient(sqsEndpointUrl ? { endpoint: sqsEndpointUrl } : {});

export const sqsQueueUrl = queueUrl;

export function buildSqsWorker() {
  return new InlineSelfHostedStartUp()
    .configure((app) =>
      useSqs(app, { queueUrl, maxNumberOfMessages: 10 }, new SqsClientFactory(sqsClient), (sqs) =>
        useMessageHandlers(sqs, PlaceOrderHandler),
      ),
    )
    .build();
}
