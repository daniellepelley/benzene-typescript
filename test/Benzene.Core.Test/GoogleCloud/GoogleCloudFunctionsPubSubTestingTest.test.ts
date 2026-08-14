/**
 * The startup-host harness for Google Cloud Functions Pub/Sub in action — the GCP Pub/Sub peer of
 * `BenzeneTestHostTest` (AWS/Azure) and the HTTP sibling `GoogleCloudFunctionsHttpTestingTest`. Boot the
 * REAL startup from `benzeneTestHost(...)`, override any dependency with `.withServices(...)`, finish with
 * the ONE GCP-specific line `buildGooglePubSubFunctionHost`, turn a neutral `messageBuilder(...)` into the
 * native Pub/Sub payload with `asPubSubEvent` (or build one directly with `PubSubMessageBuilder`), push it
 * in with `host.sendPubSubAsync(...)`, and assert on egress through a faked client. Pub/Sub is a
 * fire-and-consume trigger, so there is no response to map — the egress assertion is the whole test, as in
 * the consumer-worker tests. No live Functions Framework host, no credentials.
 *
 * Consistency law: bar the `buildGooglePubSubFunctionHost` free-function form (see the README ledger) and
 * the `asPubSubEvent` builder name, lines 1/2/(egress) read identically to the AWS/Azure/GCF-HTTP harness
 * tests.
 */
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { benzeneTestHost, FakeBenzeneMessageSender, messageBuilder } from '@benzenejs/testing';
import {
  GooglePubSubFunctionApplicationBuilder,
  GooglePubSubFunctionStartUp,
  usePubSub,
} from '@benzenejs/google-cloud-functions-pubsub';
import {
  asPubSubEvent,
  buildGooglePubSubFunctionHost,
  PubSubMessageBuilder,
} from '@benzenejs/google-cloud-functions-pubsub-testing';

const MessageTopics = {
  placeOrder: 'order:place',
  orderCreated: 'order:created',
} as const;

class PlaceOrder {
  id?: string;
  name?: string;
}

class OrderDto {
  id?: string;
  name?: string;
}

const registry = new MessageHandlersRegistry();

@message(MessageTopics.placeOrder, { registry, requestType: PlaceOrder, responseType: OrderDto })
class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderDto> {
  static readonly inject = [IBenzeneMessageSender];

  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderDto>> {
    await this.sender.sendAsync(MessageTopics.orderCreated, request);
    return BenzeneResult.accepted<OrderDto>();
  }
}

/** The real sender the startup wires by default; throws if used, proving the `withServices` fake replaced it. */
class ThrowingMessageSender implements IBenzeneMessageSender {
  sendAsync<TRequest, TResponse>(): Promise<IBenzeneResultOf<TResponse>> {
    throw new Error('the real IBenzeneMessageSender was not overridden by the test fake');
  }
}

class GooglePubSubOrdersStartUp implements GooglePubSubFunctionStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
    services.addSingletonInstance(IBenzeneMessageSender, new ThrowingMessageSender());
  }

  configure(app: GooglePubSubFunctionApplicationBuilder): void {
    usePubSub(app, (pubsub) => useMessageHandlers(pubsub, PlaceOrderHandler));
  }
}

describe('benzeneTestHost — Google Cloud Functions (Pub/Sub)', () => {
  it('consumes a Pub/Sub message (asPubSubEvent) and publishes downstream (ingress → handler → egress)', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = buildGooglePubSubFunctionHost(
      benzeneTestHost(GooglePubSubOrdersStartUp).withServices((services) =>
        services.addSingletonInstance(IBenzeneMessageSender, fake),
      ),
    );

    const order: PlaceOrder = { id: 'abc', name: 'acme' };
    await host.sendPubSubAsync(asPubSubEvent(messageBuilder(MessageTopics.placeOrder, order)));

    expect(fake.lastTopic).toBe(MessageTopics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ id: 'abc', name: 'acme' });
  });

  it('consumes a message built with PubSubMessageBuilder and publishes downstream', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = buildGooglePubSubFunctionHost(
      benzeneTestHost(GooglePubSubOrdersStartUp).withServices((services) =>
        services.addSingletonInstance(IBenzeneMessageSender, fake),
      ),
    );

    const data = new PubSubMessageBuilder()
      .withTopic(MessageTopics.placeOrder)
      .withBody({ id: 'xyz', name: 'globex' })
      .build();
    await host.sendPubSubAsync(data);

    expect(fake.lastTopic).toBe(MessageTopics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ id: 'xyz', name: 'globex' });
  });
});
