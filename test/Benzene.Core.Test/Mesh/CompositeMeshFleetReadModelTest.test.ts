import { describe, expect, it } from 'vitest';
import {
  CompositeMeshFleetReadModel,
  CorrelationView,
  IMeshTraceSource,
  MeshHealth,
  MeshTimeRange,
  TraceSummary,
  TraceView,
} from '@benzene/mesh-collector';
import { IMeshUsageSource, MeshUsage, MeshUsageEntry, MeshUsageSource } from '@benzene/mesh-contracts';

/**
 * Port of test/Benzene.Mesh.Test/CompositeMeshFleetReadModelTest.cs. The backend-composed fleet read model:
 * topic stats from the usage feed (CloudWatch/App Insights), recent flows + anonymous-but-live services from
 * the trace source (X-Ray). Verifies the result-tag error vocabulary, the absent-dimension markers, and
 * fetch isolation (one failing source never blanks the whole view). `Moq` fakes -> hand-written stubs; the
 * `IMeshUsageSource.FetchUsageAsync(MeshUsageWindow?)` fakes drop the (unported) window parameter.
 */
class FakeTraceSource implements IMeshTraceSource {
  recentFlows: TraceSummary[] = [];
  trace?: TraceView;
  correlation?: CorrelationView;
  throwOnRecent = false;
  lastRecentRange: MeshTimeRange | undefined;

  getTraceAsync(): Promise<TraceView | undefined> {
    return Promise.resolve(this.trace);
  }

  getCorrelationAsync(): Promise<CorrelationView | undefined> {
    return Promise.resolve(this.correlation);
  }

  getRecentFlowsAsync(_limit?: number, range?: MeshTimeRange): Promise<readonly TraceSummary[]> {
    this.lastRecentRange = range;
    if (this.throwOnRecent) {
      throw new Error('trace backend down');
    }
    return Promise.resolve(this.recentFlows);
  }
}

class FakeUsageSource implements IMeshUsageSource {
  usage?: MeshUsage;
  throw = false;

  fetchUsageAsync(): Promise<MeshUsage | undefined> {
    if (this.throw) {
      throw new Error('usage backend down');
    }
    return Promise.resolve(this.usage);
  }
}

function entry(topic: string, status: string | undefined, count: number, avgMs?: number): MeshUsageEntry {
  return new MeshUsageEntry(topic, undefined, undefined, 'sqs', status, count, avgMs, MeshUsageSource.cloudWatch);
}

function usage(...entries: MeshUsageEntry[]): MeshUsage {
  return new MeshUsage(0, 0, 0, entries); // DateTimeOffset.UnixEpoch -> 0 ms
}

function flow(traceId: string, services: string[], failed = false): TraceSummary {
  const summary = new TraceSummary();
  summary.traceId = traceId;
  summary.services = services;
  summary.failed = failed;
  return summary;
}

describe('CompositeMeshFleetReadModel', () => {
  it('FleetAsync_BuildsTopics_FromUsage_WithResultVocabularyErrorRule', async () => {
    const usageSource = new FakeUsageSource();
    usageSource.usage = usage(
      entry('orders:create', 'success', 10),
      entry('orders:create', 'not-found', 3), // itemized failure status
      entry('orders:create', 'exception', 2), // error bucket, NOT a wire status
      entry('orders:create', 'failure', 1), // error bucket, no status
      entry('orders:create', '<missing>', 4), // no outcome -> not an error
    );
    const model = new CompositeMeshFleetReadModel(new FakeTraceSource(), [usageSource]);

    const fleet = await model.fleetAsync();

    expect(fleet.topics.length).toBe(1);
    const topic = fleet.topics[0];
    expect(topic.topic).toBe('orders:create');
    expect(topic.invocations).toBe(20); // all counts
    expect(topic.errors).toBe(6); // not-found(3) + exception(2) + failure(1); NOT success/<missing>
    expect(topic.statusCounts['success']).toBe(10);
    expect(topic.statusCounts['exception']).toBe(2);
    expect(topic.statusCounts['<missing>']).toBe(4); // raw token kept verbatim
    // CloudWatch supplies no descriptor and no duration -> both marked absent (UI renders "—").
    expect(topic.missingFeeds).toContain('descriptor');
    expect(topic.missingFeeds).toContain('duration');
    expect(topic.avgDurationMs).toBe(0);
  });

  it('FleetAsync_UsesDuration_WhenAUsageSourceMeasuresIt', async () => {
    const usageSource = new FakeUsageSource();
    usageSource.usage = usage(entry('orders:get', 'success', 2, 10), entry('orders:get', 'success', 8, 20));
    const model = new CompositeMeshFleetReadModel(new FakeTraceSource(), [usageSource]);

    const fleet = await model.fleetAsync();
    expect(fleet.topics.length).toBe(1);
    const topic = fleet.topics[0];

    expect(topic.avgDurationMs).toBeCloseTo(18, 3); // count-weighted: (2*10 + 8*20)/10
    expect(topic.missingFeeds).not.toContain('duration'); // measured -> not marked absent
  });

  it('FleetAsync_BuildsAnonymousServices_FromRecentFlows_StatsAbsent', async () => {
    const traces = new FakeTraceSource();
    traces.recentFlows = [
      flow('t1', ['orders-api', 'billing-api'], true),
      flow('t2', ['orders-api']),
    ];
    const model = new CompositeMeshFleetReadModel(traces, []);

    const fleet = await model.fleetAsync();

    expect(fleet.traces.length).toBe(2); // recent flows surfaced verbatim
    expect(fleet.services.length).toBe(2); // distinct services across flows
    const orders = fleet.services.filter((s) => s.service === 'orders-api');
    expect(orders.length).toBe(1);
    expect(orders[0].health).toBe(MeshHealth.unknown);
    // Known only from traffic: no descriptor, no health feed, and no per-service counts.
    expect(orders[0].missingFeeds).toContain('descriptor');
    expect(orders[0].missingFeeds).toContain('health');
    expect(orders[0].missingFeeds).toContain('stats');
    expect(orders[0].invocations).toBe(0);
  });

  it('FleetAsync_FailingUsageSource_LeavesTracesIntact', async () => {
    const traces = new FakeTraceSource();
    traces.recentFlows = [flow('t1', ['svc'])];
    const failing = new FakeUsageSource();
    failing.throw = true;
    const model = new CompositeMeshFleetReadModel(traces, [failing]);

    const fleet = await model.fleetAsync();

    expect(fleet.topics.length).toBe(0); // the bad usage source degrades to no topics...
    expect(fleet.traces.length).toBe(1); // ...without blanking the trace-sourced slice
    expect(fleet.services.length).toBe(1);
  });

  it('FleetAsync_FailingTraceSource_LeavesTopicsIntact', async () => {
    const usageSource = new FakeUsageSource();
    usageSource.usage = usage(entry('orders:create', 'success', 5));
    const traces = new FakeTraceSource();
    traces.throwOnRecent = true;
    const model = new CompositeMeshFleetReadModel(traces, [usageSource]);

    const fleet = await model.fleetAsync();

    expect(fleet.topics.length).toBe(1); // topics survive...
    expect(fleet.traces.length).toBe(0); // ...while the failing trace slice degrades to empty
    expect(fleet.services.length).toBe(0);
  });

  it('TraceAndCorrelation_DelegateToTheTraceSource_WhileServiceAndTopicAreOmitted', async () => {
    const traces = new FakeTraceSource();
    const traceView = new TraceView();
    traceView.traceId = 't1';
    traces.trace = traceView;
    const correlationView = new CorrelationView();
    correlationView.correlationId = 'c1';
    traces.correlation = correlationView;
    const model = new CompositeMeshFleetReadModel(traces, []);

    expect((await model.traceAsync('t1'))!.traceId).toBe('t1');
    expect((await model.correlationAsync('c1'))!.correlationId).toBe('c1');
    expect(await model.serviceAsync('orders-api')).toBeUndefined(); // no descriptor feed on this plane
    expect(await model.topicAsync('orders:create', undefined)).toBeUndefined();
  });
});
