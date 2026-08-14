/**
 * An in-memory stand-in for SQS / SNS / EventBridge, so the six services can genuinely SEND to each other
 * through the real outbound clients (`@benzenejs/clients-aws-{sqs,sns,eventbridge}`) with no cloud account.
 *
 * Each fake AWS SDK client, on send, reads the Benzene topic + body back off the command the outbound
 * converter produced, and delivers it to every service registered as a consumer of that topic on that
 * transport — invoking the consumer's in-process Lambda `handler` with a real inbound event (built with the
 * `@benzenejs/aws-lambda-testing` builders). Delivery is awaited, so a cascade (orders → payments → shipping)
 * runs to completion in one call — the deterministic in-memory analog of the async fan-out AWS would do.
 */
import { Context, Handler } from 'aws-lambda';
import { messageBuilder } from '@benzenejs/testing';
import { asEventBridge, asSns, asSqs } from '@benzenejs/aws-lambda-testing';
import type { OutboundWiring, Transport } from './meshService';

const fakeContext = {} as Context;

interface Consumer {
  service: string;
  transport: Transport;
}

/** Reads `{ StringValue }` off a v3 message-attribute map. */
function attr(attrs: Record<string, { StringValue?: string }> | undefined, key: string): string | undefined {
  return attrs?.[key]?.StringValue;
}

export class MeshBus {
  /** The service Lambdas, populated after they're all built (the fake clients read this lazily at send time). */
  readonly services: Record<string, Handler> = {};

  private readonly consumersByTopic = new Map<string, Consumer[]>();

  /** Registers that `service` consumes `topic` over `transport` (so a send to `topic` is delivered to it). */
  registerConsumer(service: string, topic: string, transport: Transport): void {
    const list = this.consumersByTopic.get(topic) ?? [];
    list.push({ service, transport });
    this.consumersByTopic.set(topic, list);
  }

  /** The {@link OutboundWiring} that publishes onto this bus — the in-memory counterpart of real SDK clients. */
  outbound(): OutboundWiring {
    return {
      sqs: this.sqsClient,
      sns: this.snsClient,
      eventBridge: this.eventBridgeClient,
      // The bus routes by the topic attribute, so the target string is nominal (a real deploy passes the
      // actual queue URL / topic ARN / bus name here).
      target: (topic, transport) => `${transport}:${topic}`,
    };
  }

  /** A fake `@aws-sdk/client-sqs` `SQSClient`: routes a `SendMessageCommand` to the topic's SQS consumers. */
  get sqsClient(): unknown {
    return { send: (command: { input: { MessageBody?: string; MessageAttributes?: Record<string, { StringValue?: string }> } }) => this.dispatch(command.input.MessageAttributes, command.input.MessageBody, 'sqs') };
  }

  /** A fake `@aws-sdk/client-sns` `SNSClient`: routes a `PublishCommand` to the topic's SNS consumers. */
  get snsClient(): unknown {
    return { send: (command: { input: { Message?: string; MessageAttributes?: Record<string, { StringValue?: string }> } }) => this.dispatch(command.input.MessageAttributes, command.input.Message, 'sns') };
  }

  /** A fake `@aws-sdk/client-eventbridge` `EventBridgeClient`: routes a `PutEventsCommand` to the topic's EventBridge consumers. */
  get eventBridgeClient(): unknown {
    return {
      send: (command: { input: { Entries?: { DetailType?: string; Detail?: string }[] } }) => {
        const entry = command.input.Entries?.[0];
        return this.deliver(entry?.DetailType, entry?.Detail, 'eventbridge');
      },
    };
  }

  private dispatch(
    attrs: Record<string, { StringValue?: string }> | undefined,
    body: string | undefined,
    transport: Transport,
  ): Promise<{ $metadata: { httpStatusCode: number } }> {
    return this.deliver(attr(attrs, 'topic'), body, transport);
  }

  private async deliver(
    topic: string | undefined,
    body: string | undefined,
    transport: Transport,
  ): Promise<{ $metadata: { httpStatusCode: number } }> {
    if (topic !== undefined) {
      const payload = parsePayload(body);
      for (const consumer of (this.consumersByTopic.get(topic) ?? []).filter((c) => c.transport === transport)) {
        const handler = this.services[consumer.service];
        if (handler !== undefined) {
          const event = buildInboundEvent(topic, payload, transport);
          await Promise.resolve((handler as (e: unknown, c: Context) => unknown)(event, fakeContext));
        }
      }
    }
    return { $metadata: { httpStatusCode: 200 } };
  }
}

function parsePayload(body: string | undefined): Record<string, unknown> {
  if (body === undefined || body === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    // EventBridge embeds outbound headers under a reserved key; strip it so the consumer sees only the payload.
    delete parsed['_benzeneHeaders'];
    return parsed;
  } catch {
    return {};
  }
}

function buildInboundEvent(topic: string, payload: Record<string, unknown>, transport: Transport): unknown {
  const message = messageBuilder(topic, payload);
  switch (transport) {
    case 'sqs':
      return asSqs(message);
    case 'sns':
      return asSns(message);
    case 'eventbridge':
      return asEventBridge(message);
    default:
      return asSqs(message);
  }
}
