import { describe, expect, it } from 'vitest';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { addOutboundRouting, IBenzeneMessageSender } from '@benzene/clients';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { useSqs } from '@benzene/clients-aws-sqs';
import { useSns } from '@benzene/clients-aws-sns';
import { useEventBridge } from '@benzene/clients-aws-eventbridge';

/**
 * The outbound AWS transport clients: a topic routed through `addOutboundRouting` + `useSqs`/`useSns`/
 * `useEventBridge` is turned into the right AWS SDK v3 command and sent via the (here captured) client.
 * These prove the send path end-to-end from `IBenzeneMessageSender.sendAsync`.
 */
function capturing(): { commands: { input: Record<string, unknown> }[]; client: unknown } {
  const commands: { input: Record<string, unknown> }[] = [];
  const client = {
    send: (command: { input: Record<string, unknown> }) => {
      commands.push(command);
      return Promise.resolve({ $metadata: { httpStatusCode: 200 } });
    },
  };
  return { commands, client };
}

function senderFor(configure: (routing: Parameters<Parameters<typeof addOutboundRouting>[1]>[0]) => void): IBenzeneMessageSender {
  const container = new DefaultBenzeneServiceContainer();
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('outbound SQS client', () => {
  it('sends the routed message as a SendMessageCommand with topic + headers as attributes', async () => {
    const { commands, client } = capturing();
    const sender = senderFor((routing) =>
      routing.route('payments:capture', (p) => useSqs(p, 'https://sqs/payments', client as SQSClient)),
    );

    const result = await sender.sendAsync('payments:capture', { orderId: 'o1' }, { tenant: 'acme' });

    expect(result.isSuccessful).toBe(true);
    expect(commands).toHaveLength(1);
    const input = commands[0]!.input as { QueueUrl: string; MessageBody: string; MessageAttributes: Record<string, { StringValue: string }> };
    expect(input.QueueUrl).toBe('https://sqs/payments');
    expect(JSON.parse(input.MessageBody)).toEqual({ orderId: 'o1' });
    expect(input.MessageAttributes['benzene-topic']!.StringValue).toBe('payments:capture');
    expect(input.MessageAttributes['tenant']!.StringValue).toBe('acme');
  });
});

describe('outbound SNS client', () => {
  it('publishes the routed message as a PublishCommand to the topic ARN', async () => {
    const { commands, client } = capturing();
    const sender = senderFor((routing) =>
      routing.route('order:placed', (p) => useSns(p, 'arn:aws:sns:eu-west-1:0:order-placed', client as SNSClient)),
    );

    const result = await sender.sendAsync('order:placed', { orderId: 'o2' });

    expect(result.isSuccessful).toBe(true);
    const input = commands[0]!.input as { TopicArn: string; Message: string; MessageAttributes: Record<string, { StringValue: string }> };
    expect(input.TopicArn).toBe('arn:aws:sns:eu-west-1:0:order-placed');
    expect(JSON.parse(input.Message)).toEqual({ orderId: 'o2' });
    expect(input.MessageAttributes['benzene-topic']!.StringValue).toBe('order:placed');
  });
});

describe('outbound EventBridge client', () => {
  it('puts the routed message as a PutEvents entry: topic -> DetailType, source -> Source, body + headers -> Detail', async () => {
    const { commands, client } = capturing();
    const sender = senderFor((routing) =>
      routing.route('payment:captured', (p) =>
        useEventBridge(p, 'payments-api', client as EventBridgeClient, 'benzene-bus'),
      ),
    );

    const result = await sender.sendAsync('payment:captured', { orderId: 'o3' }, { traceparent: 'tp' });

    expect(result.isSuccessful).toBe(true);
    const entry = (commands[0]!.input as { Entries: { Source: string; DetailType: string; Detail: string; EventBusName: string }[] }).Entries[0]!;
    expect(entry.Source).toBe('payments-api');
    expect(entry.DetailType).toBe('payment:captured');
    expect(entry.EventBusName).toBe('benzene-bus');
    const detail = JSON.parse(entry.Detail) as { orderId: string; _benzeneHeaders: Record<string, string> };
    expect(detail.orderId).toBe('o3');
    expect(detail._benzeneHeaders.traceparent).toBe('tp');
  });
});
