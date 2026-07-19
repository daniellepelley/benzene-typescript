import { describe, expect, it } from 'vitest';
import { VoidResult } from '@benzene/abstractions';
import { MessageSenderDefinition } from '@benzene/core-messages';

/** Port of the Benzene.Core.Messages.MessageSenderDefinition factory scenarios. */

class GetOrder {}
class GetOrderResponse {}
class OrderSender {}

describe('MessageSenderDefinition', () => {
  it('create with all types builds a full definition', () => {
    const definition = MessageSenderDefinition.create('order:get', GetOrder, GetOrderResponse, OrderSender, 'v2');

    expect(definition.topic.id).toBe('order:get');
    expect(definition.topic.version).toBe('v2');
    expect(definition.requestType).toBe(GetOrder);
    expect(definition.responseType).toBe(GetOrderResponse);
    expect(definition.senderType).toBe(OrderSender);
  });

  it('create defaults omitted types to the Void sentinel and version to empty', () => {
    const definition = MessageSenderDefinition.create('order:get', GetOrder);

    expect(definition.topic.id).toBe('order:get');
    expect(definition.topic.version).toBe('');
    expect(definition.requestType).toBe(GetOrder);
    expect(definition.responseType).toBe(VoidResult);
    expect(definition.senderType).toBe(VoidResult);
  });

  it('create accepts a prebuilt topic', () => {
    const definition = MessageSenderDefinition.create({ id: 'order:get', version: 'v1' }, GetOrder);
    expect(definition.topic.version).toBe('v1');
  });

  it('empty is the missing-topic, all-Void sentinel', () => {
    const definition = MessageSenderDefinition.empty();

    expect(definition.topic.id).toBe('<missing>');
    expect(definition.requestType).toBe(VoidResult);
    expect(definition.responseType).toBe(VoidResult);
    expect(definition.senderType).toBe(VoidResult);
  });
});
