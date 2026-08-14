import { describe, expect, it } from 'vitest';
import {
  CompositeMeshFleetReadModel,
  CorrelationView,
  IMeshTraceSource,
  MeshCollectorStore,
  MeshTimeRange,
  MeshTimeRangeResolver,
  TraceSummary,
  TraceView,
} from '@benzenejs/mesh-collector';
import { IMeshUsageSource, MeshUsage, MeshUsageEntry, MeshUsageSource } from '@benzenejs/mesh-contracts';
import { MeshTraceEvent } from '@benzenejs/mesh-wire';

/**
 * Port of test/Benzene.Mesh.Test/MeshTimeRangeTest.cs. Pins the Grafana-grammar resolver, the push-collector
 * plane's flows-honor-window / counts-cumulative-since-start self-description, and the composite plane
 * threading the range to its trace source while reporting the usage feed's own window.
 *
 * `DateTimeOffset` -> epoch-ms `number`; the `"O"` round-trip format -> `Date#toISOString`. Because the TS
 * `IMeshUsageSource.fetchUsageAsync` has no `MeshUsageWindow` parameter, the "window-honoring" fakes return
 * the requested 1h window directly (rather than echoing a passed one) - this still exercises the composite's
 * honored-vs-cumulative `countsWindowed` decision, which is the ported logic under test.
 */
const Now = Date.UTC(2026, 6, 24, 12, 0, 0); // 2026-07-24T12:00:00Z
const OneHourMs = 60 * 60 * 1000;
const OneMinuteMs = 60 * 1000;

describe('MeshTimeRange resolver', () => {
  it.each([
    ['now', 0],
    ['now-5m', -5 * 60],
    ['now-1h', -60 * 60],
    ['now-24h', -24 * 60 * 60],
    ['now-7d', -7 * 24 * 60 * 60],
    ['now-1d/d', -24 * 60 * 60], // trailing rounding suffix accepted and ignored
  ])('Resolve_GrafanaRelative_ResolvesAgainstNow(%s)', (from, expectedOffsetSeconds) => {
    const window = MeshTimeRangeResolver.resolve({ from }, Now);

    expect(window).toBeDefined();
    expect(window!.from).toBe(Now + expectedOffsetSeconds * 1000);
    expect(window!.to).toBe(Now); // null To => now
  });

  it('Resolve_AbsoluteIso_IsUsedVerbatim', () => {
    const window = MeshTimeRangeResolver.resolve(
      { from: '2026-07-24T10:00:00Z', to: '2026-07-24T11:00:00Z' },
      Now,
    );

    expect(window).toBeDefined();
    expect(window!.from).toBe(Date.UTC(2026, 6, 24, 10, 0, 0));
    expect(window!.to).toBe(Date.UTC(2026, 6, 24, 11, 0, 0));
  });

  it.each([
    [undefined], // no range at all
    [''], // no lower bound
    ['garbage'], // unparseable lower bound
  ])('Resolve_NoLowerBound_IsUnfiltered(%s)', (from) => {
    const range = from === undefined ? undefined : { from };
    expect(MeshTimeRangeResolver.resolve(range, Now)).toBeUndefined();
  });
});

function event(traceId: string, startedAt: number, correlationId?: string): MeshTraceEvent {
  const evt = new MeshTraceEvent();
  evt.traceId = traceId;
  evt.spanId = traceId + '-s';
  evt.service = 'svc';
  evt.topic = 'orders:create';
  evt.status = 'ok';
  evt.durationMs = 1;
  evt.startedAt = startedAt;
  evt.correlationId = correlationId;
  return evt;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

describe('MeshTimeRange push-collector plane', () => {
  it('Fleet_WithWindow_FiltersFlowsButBadgesCountsAsCumulative', () => {
    const store = new MeshCollectorStore();
    store.addEvents([
      event('old', Now - 3 * OneHourMs), // outside a 1h window
      event('recent', Now - 10 * OneMinuteMs), // inside
    ]);

    const range: MeshTimeRange = { from: iso(Now - OneHourMs), to: iso(Now + OneMinuteMs) };
    const fleet = store.fleet(range);

    // Only the in-window flow survives; the cumulative topic count still reflects BOTH events.
    expect(fleet.traces.length).toBe(1);
    expect(fleet.traces[0].traceId).toBe('recent');
    expect(fleet.topics.length).toBe(1);
    expect(fleet.topics[0].invocations).toBe(2);

    // The window self-describes: flows honored [from,to], counts are cumulative-since-start.
    expect(fleet.window).toBeDefined();
    expect(fleet.window!.countsWindowed).toBe(false);
    expect(fleet.window!.countsSince).toBeDefined(); // the collector's start
  });

  it('Fleet_WithoutWindow_OmitsWindow_AndReturnsTodaysFlows', () => {
    const store = new MeshCollectorStore();
    store.addEvents([event('a', Now - 3 * OneHourMs), event('b', Now - 10 * OneMinuteMs)]);

    const fleet = store.fleet();

    expect(fleet.window).toBeUndefined(); // absent field = today's shape
    expect(fleet.traces.length).toBe(2); // unfiltered
  });

  it('Correlation_WithWindow_FiltersByTraceStart_AndReportsWindow', () => {
    const store = new MeshCollectorStore();
    store.addEvents([
      event('old', Now - 3 * OneHourMs, 'corr'),
      event('recent', Now - 10 * OneMinuteMs, 'corr'),
    ]);

    const range: MeshTimeRange = { from: iso(Now - OneHourMs), to: iso(Now + OneMinuteMs) };
    const view = store.correlation('corr', range);

    expect(view).toBeDefined();
    expect(view!.traces.length).toBe(1);
    expect(view!.traces[0].traceId).toBe('recent');
    expect(view!.window).toBeDefined();
    expect(view!.window!.countsWindowed).toBe(false);
  });

  it('Topic_StandaloneResponse_CarriesWindow_ButEmbeddedInFleetDoesNot', () => {
    const store = new MeshCollectorStore();
    store.addEvents([event('t', Now - 10 * OneMinuteMs)]);
    const range: MeshTimeRange = { from: iso(Now - OneHourMs) };

    const standalone = store.topic('orders:create', undefined, range);
    expect(standalone!.window).toBeDefined(); // the :topic response carries it

    const embedded = store.fleet(range).topics[0];
    expect(embedded.window).toBeUndefined(); // the fleet's one window covers the view; the row's stays null
  });
});

class WindowCapturingTraceSource implements IMeshTraceSource {
  lastRange: MeshTimeRange | undefined;

  getTraceAsync(): Promise<TraceView | undefined> {
    return Promise.resolve(undefined);
  }

  getCorrelationAsync(): Promise<CorrelationView | undefined> {
    return Promise.resolve(undefined);
  }

  getRecentFlowsAsync(_limit?: number, range?: MeshTimeRange): Promise<readonly TraceSummary[]> {
    this.lastRange = range;
    return Promise.resolve([]);
  }
}

// A usage source that reports its own fixed window - the "can't be sub-windowed" case (a cumulative feed).
class FixedUsageSource implements IMeshUsageSource {
  constructor(private readonly report: MeshUsage) {}

  fetchUsageAsync(): Promise<MeshUsage | undefined> {
    return Promise.resolve(this.report);
  }
}

// A usage source that reports the requested 1h window - queried over exactly those bounds (the
// CloudWatch/App-Insights behavior after the count-windowing fast-follow), returning it on the MeshUsage.
class WindowHonoringUsageSource implements IMeshUsageSource {
  fetchUsageAsync(): Promise<MeshUsage | undefined> {
    const now = Date.now();
    const entry = new MeshUsageEntry('orders:create', undefined, undefined, 'sqs', 'success', 5, undefined, MeshUsageSource.cloudWatch);
    return Promise.resolve(new MeshUsage(now, now - OneHourMs, now, [entry]));
  }
}

describe('MeshTimeRange composite plane', () => {
  it('Composite_ThreadsRangeToTraceSource_AndReportsUsageFeedWindow', async () => {
    const traceSource = new WindowCapturingTraceSource();
    const usageStart = Date.UTC(2026, 6, 23, 12, 0, 0); // the usage feed's own baked window, far in the past
    const report = new MeshUsage(
      Date.now(),
      usageStart,
      Date.now(),
      [new MeshUsageEntry('orders:create', undefined, undefined, 'sqs', 'success', 5, undefined, MeshUsageSource.cloudWatch)],
    );
    const model = new CompositeMeshFleetReadModel(traceSource, [new FixedUsageSource(report)]);

    const range: MeshTimeRange = { from: 'now-1h' };
    const fleet = await model.fleetAsync(range);

    // The picked range reached the trace source (flows honor it)...
    expect(traceSource.lastRange).toBe(range);
    // ...but the composite reports counts as NOT windowed, covering the usage feed's own window.
    expect(fleet.window).toBeDefined();
    expect(fleet.window!.countsWindowed).toBe(false);
    expect(fleet.window!.countsSince).toBe(MeshTimeRangeResolver.toIso(usageStart));
  });

  it('Composite_WhenEveryUsageSourceHonorsTheWindow_CountsAreWindowed', async () => {
    // Every usage source echoes the requested window => the counts really cover [from,to] => countsWindowed.
    const model = new CompositeMeshFleetReadModel(new WindowCapturingTraceSource(), [new WindowHonoringUsageSource()]);

    const fleet = await model.fleetAsync({ from: 'now-1h' });

    expect(fleet.window).toBeDefined();
    expect(fleet.window!.countsWindowed).toBe(true);
    expect(fleet.window!.countsSince).toBeUndefined(); // no "cumulative from" caveat
  });

  it('Composite_WhenAnyUsageSourceCannotWindow_CountsStayCumulative', async () => {
    // One honoring source + one that can't (a cumulative window) => the union isn't windowed => false.
    const now = Date.now();
    const cumulative = new MeshUsage(
      now,
      now - 30 * 24 * OneHourMs,
      now,
      [new MeshUsageEntry('orders:create', undefined, undefined, 'sqs', 'success', 3, undefined, MeshUsageSource.collector)],
    );
    const model = new CompositeMeshFleetReadModel(new WindowCapturingTraceSource(), [
      new WindowHonoringUsageSource(),
      new FixedUsageSource(cumulative),
    ]);

    const fleet = await model.fleetAsync({ from: 'now-1h' });

    expect(fleet.window).toBeDefined();
    expect(fleet.window!.countsWindowed).toBe(false);
    expect(fleet.window!.countsSince).toBeDefined(); // surfaces the earliest window the counts actually cover
  });
});
