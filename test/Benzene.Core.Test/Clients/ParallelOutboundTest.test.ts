import { describe, expect, it } from 'vitest';
import { VoidResult } from '@benzene/abstractions';
import { addOutboundRouting, IBenzeneMessageSender, OutboundRoutingBuilder, useParallel } from '@benzene/clients';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult } from '@benzene/results';

/** Port of test/Benzene.Core.Test/Clients/ParallelOutboundTest.cs. */

function senderFor(configure: (routing: OutboundRoutingBuilder) => void): IBenzeneMessageSender {
  const container = new DefaultBenzeneServiceContainer();
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('useParallel', () => {
  it('runs branches concurrently, not one after another', async () => {
    let live = 0;
    let maxLive = 0;
    let arrived = 0;
    let release!: () => void;
    // A rendezvous both branches must reach before either may finish: only satisfiable if both are in
    // flight at once, so it proves concurrency deterministically (no wall-clock timing).
    const bothInFlight = new Promise<void>((resolve) => {
      release = resolve;
    });

    const branchBody = () => async () => {
      live += 1;
      maxLive = Math.max(maxLive, live);
      arrived += 1;
      if (arrived === 2) {
        release();
      }
      await bothInFlight;
      live -= 1;
    };

    const sender = senderFor((routing) =>
      routing.route('order:create', (pipeline) =>
        useParallel(pipeline, [
          {
            name: 'a',
            configure: (b) =>
              b.useFn('a', async (ctx, _next) => {
                await branchBody()();
                ctx.response = BenzeneResult.ok<VoidResult>();
              }),
          },
          {
            name: 'b',
            configure: (b) =>
              b.useFn('b', async (ctx, _next) => {
                await branchBody()();
                ctx.response = BenzeneResult.ok<VoidResult>();
              }),
          },
        ]),
      ),
    );

    const result = await sender.sendAsync<string, VoidResult>('order:create', 'payload');

    expect(result.isSuccessful).toBe(true);
    expect(maxLive).toBe(2); // both branches were in flight at once
  });

  it('all branches succeeding aggregates to success', async () => {
    const sender = senderFor((routing) =>
      routing.route('order:create', (pipeline) =>
        useParallel(pipeline, [
          { name: 'sqs', configure: (b) => b.onRequest((ctx) => (ctx.response = BenzeneResult.ok<VoidResult>())) },
          { name: 'sns', configure: (b) => b.onRequest((ctx) => (ctx.response = BenzeneResult.ok<VoidResult>())) },
        ]),
      ),
    );

    const result = await sender.sendAsync<string, VoidResult>('order:create', 'payload');

    expect(result.isSuccessful).toBe(true);
  });

  it('one branch throwing fails and names it, but still runs the others', async () => {
    let snsRan = false;

    const sender = senderFor((routing) =>
      routing.route('order:create', (pipeline) =>
        useParallel(pipeline, [
          {
            name: 'sqs',
            configure: (b) =>
              b.useFn('sqs', async () => {
                throw new Error('access denied');
              }),
          },
          {
            name: 'sns',
            configure: (b) =>
              b.useFn('sns', async (ctx, _next) => {
                snsRan = true;
                ctx.response = BenzeneResult.ok<VoidResult>();
              }),
          },
        ]),
      ),
    );

    const result = await sender.sendAsync<string, VoidResult>('order:create', 'payload');

    expect(result.isSuccessful).toBe(false);
    expect(snsRan).toBe(true); // a failing branch must not abort the fan-out
    expect(result.errors.some((e) => e.includes('sqs') && e.includes('access denied'))).toBe(true);
  });

  it('one branch returning a failure result fails and names it', async () => {
    const sender = senderFor((routing) =>
      routing.route('order:create', (pipeline) =>
        useParallel(pipeline, [
          { name: 'sqs', configure: (b) => b.onRequest((ctx) => (ctx.response = BenzeneResult.ok<VoidResult>())) },
          { name: 'sns', configure: (b) => b.onRequest((ctx) => (ctx.response = BenzeneResult.serviceUnavailable())) },
        ]),
      ),
    );

    const result = await sender.sendAsync<string, VoidResult>('order:create', 'payload');

    expect(result.isSuccessful).toBe(false);
    expect(result.errors.some((e) => e.includes('sns'))).toBe(true);
  });
});
