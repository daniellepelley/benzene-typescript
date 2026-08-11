import { describe, expect, it } from 'vitest';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { SqsBatchMessageClient } from '@benzene/clients-aws-sqs';
import { SnsBatchMessageClient } from '@benzene/clients-aws-sns';
import { EventBridgeBatchMessageClient } from '@benzene/clients-aws-eventbridge';

/**
 * The native-batch outbound clients: a collection of client requests is chunked to the provider's per-batch
 * limit (10), each entry built by the same converter the single-send path uses, and per-entry / chunk-level
 * failures reported back against the caller's index. These mock the AWS SDK v3 client's `send`.
 */
function req(topic: string, message: unknown, headers: Record<string, string> = {}): IBenzeneClientRequest<unknown> {
  return { topic, message, headers };
}

/** A capturing SDK client whose `send` returns a canned response (or throws) per call. */
function capturing(respond: (command: { input: Record<string, unknown> }, call: number) => unknown) {
  const commands: { input: Record<string, unknown> }[] = [];
  let call = 0;
  const client = {
    send: (command: { input: Record<string, unknown> }) => {
      commands.push(command);
      const result = respond(command, call++);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  return { commands, client };
}

describe('SqsBatchMessageClient', () => {
  it('chunks to 10 per SendMessageBatch and reports all-success', async () => {
    const { commands, client } = capturing(() => ({}));
    const batch = new SqsBatchMessageClient(client as unknown as SQSClient, 'https://sqs/q');
    const requests = Array.from({ length: 12 }, (_, i) => req('orders:create', { i }, { tenant: 'acme' }));

    const result = await batch.sendBatchAsync(requests);

    expect(result.allSucceeded).toBe(true);
    expect(commands).toHaveLength(2); // 10 + 2
    const first = commands[0]!.input as { QueueUrl: string; Entries: { Id: string; MessageBody: string; MessageAttributes: Record<string, { StringValue: string }> }[] };
    expect(first.QueueUrl).toBe('https://sqs/q');
    expect(first.Entries).toHaveLength(10);
    // Entry ids carry the caller's index; the body + topic attribute match the single-send converter.
    expect(first.Entries[0]!.Id).toBe('0');
    expect(JSON.parse(first.Entries[0]!.MessageBody)).toEqual({ i: 0 });
    expect(first.Entries[0]!.MessageAttributes['topic']!.StringValue).toBe('orders:create');
    expect(first.Entries[0]!.MessageAttributes['tenant']!.StringValue).toBe('acme');
    const second = commands[1]!.input as { Entries: { Id: string }[] };
    expect(second.Entries.map((e) => e.Id)).toEqual(['10', '11']);
  });

  it('maps a per-entry Failed back to its original index', async () => {
    const { client } = capturing(() => ({ Failed: [{ Id: '1', Code: 'InternalError', Message: 'nope' }] }));
    const batch = new SqsBatchMessageClient(client as unknown as SQSClient, 'https://sqs/q');

    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 })]);

    expect(result.allSucceeded).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.index).toBe(1);
    expect(result.failures[0]!.errorCode).toBe('InternalError');
  });

  it('fails a whole chunk (against each index) when the batch call throws', async () => {
    const { client } = capturing(() => Object.assign(new Error('throttled'), { name: 'ThrottlingException' }));
    const batch = new SqsBatchMessageClient(client as unknown as SQSClient, 'https://sqs/q');

    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 })]);

    expect(result.failures.map((f) => f.index)).toEqual([0, 1]);
    expect(result.failures[0]!.errorCode).toBe('ThrottlingException');
  });
});

describe('SnsBatchMessageClient', () => {
  it('publishes a PublishBatch with topic + headers as attributes and maps failures', async () => {
    const { commands, client } = capturing((_c, call) =>
      call === 0 ? { Failed: [{ Id: '0', Code: 'Throttled', Message: 'slow down' }] } : {},
    );
    const batch = new SnsBatchMessageClient(client as unknown as SNSClient, 'arn:aws:sns:eu:0:topic');

    const result = await batch.sendBatchAsync([req('order:placed', { id: 1 }, { tenant: 'acme' })]);

    const input = commands[0]!.input as { TopicArn: string; PublishBatchRequestEntries: { Id: string; Message: string; MessageAttributes: Record<string, { StringValue: string }> }[] };
    expect(input.TopicArn).toBe('arn:aws:sns:eu:0:topic');
    expect(JSON.parse(input.PublishBatchRequestEntries[0]!.Message)).toEqual({ id: 1 });
    expect(input.PublishBatchRequestEntries[0]!.MessageAttributes['topic']!.StringValue).toBe('order:placed');
    expect(result.failures[0]!.index).toBe(0);
    expect(result.failures[0]!.errorCode).toBe('Throttled');
  });
});

describe('EventBridgeBatchMessageClient', () => {
  it('sends a PutEvents and maps positional failures back to the caller index', async () => {
    // PutEvents responds positionally: entry 0 ok, entry 1 failed.
    const { commands, client } = capturing(() => ({
      FailedEntryCount: 1,
      Entries: [{ EventId: 'e0' }, { ErrorCode: 'InternalException', ErrorMessage: 'boom' }],
    }));
    const batch = new EventBridgeBatchMessageClient(client as unknown as EventBridgeClient, 'orders.service');

    const result = await batch.sendBatchAsync([req('orders:created', { id: 1 }), req('orders:created', { id: 2 })]);

    const input = commands[0]!.input as { Entries: { Source: string; DetailType: string }[] };
    expect(input.Entries).toHaveLength(2);
    expect(input.Entries[0]!.Source).toBe('orders.service');
    expect(input.Entries[0]!.DetailType).toBe('orders:created');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.index).toBe(1);
    expect(result.failures[0]!.errorCode).toBe('InternalException');
  });
});
