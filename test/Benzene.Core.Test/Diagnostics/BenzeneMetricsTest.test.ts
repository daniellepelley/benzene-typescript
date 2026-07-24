import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IBenzeneResult } from '@benzene/abstractions';
import { IHasMessageResult } from '@benzene/abstractions-message-handlers';
import { useBenzeneMetrics } from '@benzene/diagnostics';
import { addBenzeneMiddleware, MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { OtelHarness } from './otelHarness';

/**
 * Port of test/Benzene.Core.Test/Diagnostics/BenzeneMetricsTest.cs. The C# `MeterListener` is replaced by
 * an in-memory OpenTelemetry metric reader (see otelHarness.ts). The failure `result` tag is the port's
 * status string (`NotFound`, not the .NET `not-found`).
 */

const harness = new OtelHarness();
beforeEach(() => harness.start());
afterEach(() => harness.stop());

class FakeMessageContext implements IHasMessageResult {
  messageResult: IBenzeneResult = BenzeneResult.ok();
}

async function run(context: FakeMessageContext, throwing = false): Promise<void> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzeneMiddleware(container);

  const builder = new MiddlewarePipelineBuilder<FakeMessageContext>(container);
  useBenzeneMetrics(builder);
  builder.useFn('handle', (_c, next) => {
    if (throwing) {
      throw new Error('boom');
    }
    return next();
  });

  const resolver = container.createServiceResolverFactory().createScope();
  await builder.build().handleAsync(context, resolver);
}

function resultTag(points: { attributes: Record<string, unknown> }[]): unknown {
  expect(points).toHaveLength(1);
  return points[0]!.attributes.result;
}

describe('useBenzeneMetrics', () => {
  it('records the counter and histogram tagged by result/topic/transport', async () => {
    await run(new FakeMessageContext());

    const counts = await harness.metricPoints('benzene.messages.processed');
    expect(counts).toHaveLength(1);
    expect(counts[0]!.attributes.result).toBe('success');
    expect(counts[0]!.attributes.topic).toBe('<missing>');
    expect(counts[0]!.attributes.transport).toBe('<missing>');

    const durations = await harness.metricPoints('benzene.message.duration');
    expect(durations).toHaveLength(1);
    expect(durations[0]!.attributes.result).toBe('success');
  });

  it('records result=exception when the pipeline throws, still propagating', async () => {
    await expect(run(new FakeMessageContext(), true)).rejects.toThrow('boom');

    expect(resultTag(await harness.metricPoints('benzene.messages.processed'))).toBe('exception');
    expect(await harness.metricPoints('benzene.message.duration')).toHaveLength(1);
  });

  it('records an unsuccessful result by its root-cause status, not just "failure"', async () => {
    const context = new FakeMessageContext();
    context.messageResult = BenzeneResult.notFound('nope');
    await run(context);

    expect(resultTag(await harness.metricPoints('benzene.messages.processed'))).toBe(BenzeneResultStatus.notFound);
  });

  it('records a successful result carrying a failure-class status as "success"', async () => {
    const context = new FakeMessageContext();
    context.messageResult = BenzeneResult.set(BenzeneResultStatus.serviceUnavailable, undefined, true);
    await run(context);

    expect(resultTag(await harness.metricPoints('benzene.messages.processed'))).toBe('success');
  });

  it('records a null message result as "<missing>" without throwing', async () => {
    const context = new FakeMessageContext();
    context.messageResult = null as unknown as IBenzeneResult;
    await run(context);

    expect(resultTag(await harness.metricPoints('benzene.messages.processed'))).toBe('<missing>');
  });
});
