/**
 * The SQS leg: a long-running worker process polling one queue, dispatching every message to the same
 * `PlaceOrderHandler` `api.ts` exposes over HTTP. `useSqs` wires the SQS message getters and
 * `useMessageHandlers` routes each poll batch to `PlaceOrderHandler` by its `@message('order-place')`
 * — the same handler import as every other leg, wired explicitly (this port has no reflection-based
 * handler discovery).
 *
 * Run with:
 *
 *     QUEUE_URL=http://localhost:4566/000000000000/orders-in npm run start:sqs-worker -w @benzene-example/k8s-orders
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

export function buildSqsWorker() {
  return new InlineSelfHostedStartUp()
    .configure((app) =>
      useSqs(app, { queueUrl, maxNumberOfMessages: 10 }, new SqsClientFactory(sqsClient), (sqs) =>
        useMessageHandlers(sqs, PlaceOrderHandler),
      ),
    )
    .build();
}

async function main(): Promise<void> {
  const worker = buildSqsWorker();
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());

  console.log(`orders-sqs-worker polling ${queueUrl}`);
  await worker.startAsync(controller.signal);
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
