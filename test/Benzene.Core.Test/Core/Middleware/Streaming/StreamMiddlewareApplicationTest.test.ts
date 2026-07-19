import { describe, expect, it } from 'vitest';
import {
  MiddlewarePipelineBuilder,
  NullStreamCheckpointer,
  StreamContext,
  StreamMiddlewareApplication,
  useStream,
} from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * Port of Benzene.Test.Core.Middleware.Streaming.StreamMiddlewareApplicationTest
 * (test/Benzene.Core.Test/Core/Middleware/Streaming/StreamMiddlewareApplicationTest.cs).
 *
 * C# `MicrosoftBenzeneServiceContainer`/`MicrosoftServiceResolverFactory` map to the first-party
 * `DefaultBenzeneServiceContainer`; the C# `ToAsyncEnumerable` helper (an `async IAsyncEnumerable`
 * iterator) maps to an `async function*`.
 */

async function* toAsyncIterable<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe('StreamMiddlewareApplicationTest', () => {
  it('Stream_ReceivesWholeBatch_AsOneOrderedStream_InASingleRun', async () => {
    const collected: number[] = [];
    let runs = 0;

    const container = new DefaultBenzeneServiceContainer();
    const builder = new MiddlewarePipelineBuilder<StreamContext<number>>(container);
    useStream<number>(builder, async (context) => {
      runs++;
      for await (const item of context.items) {
        collected.push(item);
      }
    });
    const pipeline = builder.build();

    const app = new StreamMiddlewareApplication<number[], number>(
      pipeline,
      (batch) => new StreamContext<number>(toAsyncIterable(batch)),
    );

    await app.handleAsync([1, 2, 3, 4, 5], container.createServiceResolverFactory());

    // Fan-in: the pipeline ran once for the whole batch, not once per item.
    expect(runs).toBe(1);
    // And the step saw every item, in order.
    expect(collected).toEqual([1, 2, 3, 4, 5]);
  });

  it('UseStream_ItemsAndCancellationOverload_ReceivesTheItems', async () => {
    const collected: number[] = [];

    const container = new DefaultBenzeneServiceContainer();
    const builder = new MiddlewarePipelineBuilder<StreamContext<number>>(container);
    // The items+signal overload's callback params are annotated: TypeScript contextually types an
    // un-annotated arrow from a function's *first* overload only, so the second (items, signal)
    // overload does not flow inferred types to a bare `(items, _signal) =>` the way C# infers them.
    useStream<number>(builder, async (items: AsyncIterable<number>, _signal: AbortSignal | undefined) => {
      for await (const item of items) {
        collected.push(item);
      }
    });
    const pipeline = builder.build();

    const app = new StreamMiddlewareApplication<number[], number>(
      pipeline,
      (batch) => new StreamContext<number>(toAsyncIterable(batch)),
    );

    await app.handleAsync([10, 20, 30], container.createServiceResolverFactory());

    expect(collected).toEqual([10, 20, 30]);
  });

  it('NullStreamCheckpointer_IsTheDefault_AndNoOps', async () => {
    const context = new StreamContext<number>(toAsyncIterable([1]));

    expect(context.checkpointer).toBeInstanceOf(NullStreamCheckpointer);
    await context.checkpointer.checkpointAsync(1); // does not throw
  });
});
