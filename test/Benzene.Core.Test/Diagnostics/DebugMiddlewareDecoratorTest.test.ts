import { describe, expect, it } from 'vitest';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { NullServiceResolver } from '@benzene/core-middleware';
import { DebugMiddlewareDecorator, DebugMiddlewareWrapper } from '@benzene/diagnostics';

/** Port of Benzene.Test.Diagnostics.DebugMiddlewareDecoratorTest. */

/**
 * A hand-rolled fake standing in for the C# `Mock<IMiddleware<object>>`; records the arguments
 * `HandleAsync` was called with and forwards to `next` (mirroring the Moq `.Returns(next => next())`
 * setup used in the C# test).
 */
class FakeMiddleware implements IMiddleware<object> {
  handleCalls = 0;
  lastContext?: object;
  lastNext?: NextFunc;

  constructor(readonly name: string) {}

  async handleAsync(context: object, next: NextFunc): Promise<void> {
    this.handleCalls++;
    this.lastContext = context;
    this.lastNext = next;
    await next();
  }
}

describe('DebugMiddlewareDecoratorTest', () => {
  it('Name_DelegatesToTheInnerMiddleware', () => {
    const inner = new FakeMiddleware('my-middleware');

    const decorator = new DebugMiddlewareDecorator<object>(inner);

    expect(decorator.name).toBe('my-middleware');
  });

  it('HandleAsync_DelegatesToTheInnerMiddleware_WithTheSameContextAndNext', async () => {
    const context = {};
    let nextCalled = false;
    const next: NextFunc = () => {
      nextCalled = true;
      return Promise.resolve();
    };

    const inner = new FakeMiddleware('my-middleware');

    const decorator = new DebugMiddlewareDecorator<object>(inner);

    await decorator.handleAsync(context, next);

    expect(inner.handleCalls).toBe(1);
    expect(inner.lastContext).toBe(context);
    expect(inner.lastNext).toBe(next);
    expect(nextCalled).toBe(true);
  });

  it('Wrap_ReturnsADebugMiddlewareDecoratorAroundTheGivenMiddleware', () => {
    const inner = new FakeMiddleware('my-middleware');

    const wrapped = new DebugMiddlewareWrapper().wrap(new NullServiceResolver(), inner);

    expect(wrapped).toBeInstanceOf(DebugMiddlewareDecorator);
    expect(wrapped.name).toBe('my-middleware');
  });

  it('HandleAsync_EmitsStartAndCompleteDebugOutput_AroundTheInnerMiddleware', async () => {
    // Additive to the C# suite: exercises the debug sink the port substitutes for
    // System.Diagnostics.Debug.WriteLine (which the C# test cannot observe).
    const messages: string[] = [];
    const inner = new FakeMiddleware('my-middleware');

    const decorator = new DebugMiddlewareDecorator<object>(inner, (m) => messages.push(m));

    await decorator.handleAsync({}, () => Promise.resolve());

    expect(messages).toEqual([
      'Middleware - my-middleware starting',
      'Middleware - my-middleware completed',
    ]);
  });
});
