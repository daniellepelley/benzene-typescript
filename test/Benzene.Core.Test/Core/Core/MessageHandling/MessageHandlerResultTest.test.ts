import { describe, expect, it } from 'vitest';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  MessageHandlerResult,
  MessageHandlerResultOf,
} from '@benzene/core-message-handlers';

/**
 * Port of the MessageHandlerResult scenarios — covers both the untyped `MessageHandlerResult`
 * and the strongly-typed `MessageHandlerResultOf<TResponse>` (C# `MessageHandlerResult<TResponse>`),
 * including the typed→untyped conversion (C# explicit operator → `toUntyped()`).
 */
class Order {
  constructor(public readonly orderId: string) {}
}

describe('MessageHandlerResult', () => {
  it('single-argument overload leaves routing metadata undefined', () => {
    const benzeneResult = BenzeneResult.ok();
    const result = new MessageHandlerResult(benzeneResult);

    expect(result.benzeneResult).toBe(benzeneResult);
    expect(result.topic).toBeUndefined();
    expect(result.messageHandlerDefinition).toBeUndefined();
  });

  it('three-argument overload carries routing metadata', () => {
    const benzeneResult = BenzeneResult.ok();
    const result = new MessageHandlerResult(undefined, undefined, benzeneResult);

    expect(result.benzeneResult).toBe(benzeneResult);
    expect(result.topic).toBeUndefined();
    expect(result.messageHandlerDefinition).toBeUndefined();
  });
});

describe('MessageHandlerResultOf', () => {
  it('single-argument overload leaves routing metadata undefined', () => {
    const benzeneResult = BenzeneResult.ok(new Order('123'));
    const result = new MessageHandlerResultOf(benzeneResult);

    expect(result.benzeneResult).toBe(benzeneResult);
    expect(result.benzeneResult.payload.orderId).toBe('123');
    expect(result.topic).toBeUndefined();
    expect(result.messageHandlerDefinition).toBeUndefined();
  });

  it('toUntyped preserves routing metadata and the underlying result', () => {
    const benzeneResult = BenzeneResult.ok(new Order('456'));
    const typed = new MessageHandlerResultOf(undefined, undefined, benzeneResult);

    const untyped = typed.toUntyped();

    expect(untyped).toBeInstanceOf(MessageHandlerResult);
    expect(untyped.benzeneResult).toBe(benzeneResult);
    expect(untyped.benzeneResult.status).toBe(BenzeneResultStatus.ok);
    expect(untyped.topic).toBe(typed.topic);
    expect(untyped.messageHandlerDefinition).toBe(typed.messageHandlerDefinition);
  });
});
