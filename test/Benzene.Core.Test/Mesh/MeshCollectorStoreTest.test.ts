import { describe, expect, it } from 'vitest';
import {
  CorrelationQueryMessageHandler,
  IssuesMessageHandler,
  MeshCollectorStore,
} from '@benzenejs/mesh-collector';
import {
  MeshIssue,
  MeshIssueBatch,
  MeshServiceDescriptor,
  MeshTopicDescriptor,
  MeshTraceEvent,
} from '@benzenejs/mesh-wire';
import { BenzeneResultStatus } from '@benzenejs/results';

/**
 * Port of test/Benzene.Mesh.Test/MeshCollectorStoreTest.cs. Store behaviors the conformance sequences
 * don't pin: the bounded ring window (eviction, with cumulative stats deliberately outliving it), the fleet
 * flow-list cap, the declared-graph/§4.2 observed-signal behaviors the mesh.md 2026-08 revision added, and
 * the correlation lookup. `DateTimeOffset` -> epoch-ms `number`; a null wire status -> `undefined` on
 * `MeshTraceEvent.status`; `null` returns -> `undefined`.
 */
function event(
  traceId: string,
  spanId: string,
  service: string,
  topic: string,
  startedAt: number,
  status: string | undefined = 'ok',
): MeshTraceEvent {
  const evt = new MeshTraceEvent();
  evt.traceId = traceId;
  evt.spanId = spanId;
  evt.service = service;
  evt.topic = topic;
  evt.status = status as string;
  evt.durationMs = 1;
  evt.startedAt = startedAt;
  return evt;
}

/** Builds a registrable `MeshServiceDescriptor` declaring `provides` as `topics` and `consumes` as `consumes` (ids only). */
function descriptor(service: string, provides: string[], consumes: string[]): MeshServiceDescriptor {
  const value = new MeshServiceDescriptor();
  value.service = service;
  value.topics = provides.map(topicDescriptor);
  value.consumes = consumes.map(topicDescriptor);
  return value;
}

function topicDescriptor(id: string): MeshTopicDescriptor {
  const value = new MeshTopicDescriptor();
  value.id = id;
  return value;
}

function issue(
  fingerprint: string,
  topic: string,
  count: number,
  firstSeen: number,
  lastSeen: number,
  exemplars: string[] = [],
  status = 'service-unavailable',
  classification = 'exception',
): MeshIssue {
  const value = new MeshIssue();
  value.fingerprint = fingerprint;
  value.classification = classification;
  value.service = 'orders';
  value.topic = topic;
  value.status = status;
  value.count = count;
  value.firstSeen = firstSeen;
  value.lastSeen = lastSeen;
  value.exemplarTraceIds = exemplars;
  return value;
}

function batch(service: string, issues: MeshIssue[]): MeshIssueBatch {
  const value = new MeshIssueBatch();
  value.service = service;
  value.issues = issues;
  return value;
}

function corrEvent(
  traceId: string,
  spanId: string,
  service: string,
  topic: string,
  startedAt: number,
  correlationId: string | undefined,
  status = 'ok',
): MeshTraceEvent {
  const evt = event(traceId, spanId, service, topic, startedAt, status);
  evt.correlationId = correlationId;
  return evt;
}

describe('MeshCollectorStore', () => {
  it('AddEvents_EventWithNullStatus_IsAcceptedAndCountedAsFailure', () => {
    // A wire payload can deserialize "status": null into an actual null/absent value. The §6 degradation
    // rule requires ingestion to accept it rather than throw on the null status-count key.
    const store = new MeshCollectorStore();
    // A genuinely absent status (JS applies a parameter default for explicit `undefined`, so build directly).
    const evt = event('trace-1', 'span-1', 'svc', 'topic', Date.now());
    evt.status = undefined as unknown as string;

    const accepted = store.addEvents([evt]);

    expect(accepted).toBe(1);
    const topic = store.topic('topic', undefined);
    expect(topic).toBeDefined();
    expect(topic!.invocations).toBe(1);
    expect(topic!.errors).toBe(1);
  });

  it('RingEviction_DropsTheWindowButKeepsCumulativeStats', () => {
    const store = new MeshCollectorStore(2);
    const now = Date.now();

    store.addEvents([
      event('trace-1', 'span-1', 'svc', 'topic', now),
      event('trace-1', 'span-2', 'svc', 'topic', now + 1),
    ]);
    expect(store.trace('trace-1')).toBeDefined();

    store.addEvents([
      event('trace-2', 'span-3', 'svc', 'topic', now + 2),
      event('trace-2', 'span-4', 'svc', 'topic', now + 3),
    ]);

    expect(store.trace('trace-1')).toBeUndefined(); // aged out of the bounded window
    const topic = store.topic('topic', undefined);
    expect(topic).toBeDefined();
    expect(topic!.invocations).toBe(4); // cumulative stats outlive the ring
  });

  it('FleetFlowList_IsCappedAtTwentyNewestFirst', () => {
    const store = new MeshCollectorStore();
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      store.addEvents([event(`trace-${i}`, `span-${i}`, 'svc', 'topic', now + i * 1000)]);
    }

    const fleet = store.fleet();

    expect(fleet.traces.length).toBe(20);
    expect(fleet.traces[0].startedAt).toBeGreaterThan(fleet.traces[fleet.traces.length - 1].startedAt); // newest first
    expect(fleet.traces[0].topic).toBe('topic'); // the flow's entry topic (earliest event's)
  });

  // ---- declared producer/consumer graph (mesh.md §4, the 2026-08 revision) ----

  it('TraceParentage_NeverAdmitsAConsumerEdge_TheGraphIsDeclaredOnly', () => {
    // Same shape as the pre-revision test this replaces (a genuine caller/callee parentage, plus a
    // same-service self-call that would never have counted either way) - but NEITHER service ever
    // registered, so under the 2026-08 revision the declared graph stays empty regardless of traffic.
    const store = new MeshCollectorStore();
    const now = Date.now();
    const parent = event('trace-1', 'span-parent', 'caller', 'outer', now);
    const child = event('trace-1', 'span-child', 'callee', 'inner', now + 1);
    child.parentSpanId = 'span-parent';
    const selfCall = event('trace-2', 'span-self', 'callee', 'inner', now + 2);
    selfCall.parentSpanId = 'span-child';

    store.addEvents([parent, child, selfCall]);

    const inner = store.topic('inner', undefined);
    expect(inner).toBeDefined();
    expect(inner!.consumers).toEqual([]); // no ServiceDescriptor ever declared it - trace parentage alone never does
    expect(inner!.providers).toEqual([]);
    expect(inner!.invocations).toBe(2); // stats still accrue (child + selfCall); only graph membership is unaffected
  });

  it('Register_ZeroTraffic_ReportsTheFullDeclaredGraph', () => {
    // Spec §4: "A collector MUST report this graph in full for a service that has registered but never
    // sent or received a single message."
    const store = new MeshCollectorStore();
    store.register(descriptor('payments', ['payments:capture'], []));
    store.register(descriptor('orders', ['order:create'], ['payments:capture']));

    const capture = store.topic('payments:capture', undefined);
    expect(capture).toBeDefined();
    expect(capture!.providers).toEqual(['payments']);
    expect(capture!.consumers).toEqual(['orders']);
    expect(capture!.invocations).toBe(0);
    // Declared but never exercised: present-but-empty activity per edge, not absent (the §4.2 "Unobserved"
    // decommission-candidate signal, distinguished from "never declared" by presence of the key at all).
    expect(capture!.providerActivity).toEqual({ payments: {} });
    expect(capture!.consumerActivity).toEqual({ orders: {} });
  });

  it('Reregistration_ReplacesBothProviderAndConsumerEdges', () => {
    const store = new MeshCollectorStore();
    store.register(descriptor('payments', ['payments:capture'], []));
    store.register(descriptor('orders', ['order:create'], ['payments:capture']));
    // Redeploy: orders keeps providing order:cancel instead, and stops consuming payments:capture.
    store.register(descriptor('orders', ['order:cancel'], []));

    expect(store.topic('order:create', undefined)!.providers).toEqual([]);
    expect(store.topic('payments:capture', undefined)!.consumers).toEqual([]);
    expect(store.topic('payments:capture', undefined)!.providers).toEqual(['payments']); // unrelated edge untouched
    expect(store.topic('order:cancel', undefined)!.providers).toEqual(['orders']);
  });

  it('ProviderActivity_TracksLastObservedAtPerDeclaredEdge_OnceTrafficArrives', () => {
    const store = new MeshCollectorStore();
    store.register(descriptor('payments', ['payments:capture'], []));
    store.register(descriptor('orders', ['order:create'], ['payments:capture']));

    const provide = event('trace-1', 'span-1', 'payments', 'payments:capture', Date.now());
    const consume = event('trace-1', 'span-2', 'orders', 'order:create', Date.now() + 1);
    consume.parentSpanId = undefined; // the caller of order:create is unmeshed here; irrelevant to this case
    const call = event('trace-2', 'span-3', 'payments', 'payments:capture', Date.now() + 2);
    call.parentSpanId = 'span-4';
    const callerSpan = event('trace-2', 'span-4', 'orders', 'order:create', Date.now() - 1);

    store.addEvents([callerSpan, call, provide, consume]);

    const capture = store.topic('payments:capture', undefined)!;
    expect(capture.providers).toEqual(['payments']);
    expect(capture.consumers).toEqual(['orders']);
    expect(capture.providerActivity['payments']?.lastObservedAt).toBeDefined();
    expect(capture.consumerActivity['orders']?.lastObservedAt).toBeDefined(); // seen via span-4's parentage
  });

  // ---- declared vs. observed: undeclared edges (mesh.md §4.2, contract-drift) ----

  it('ContractDrift_RegisteredProviderHandlingAnUndeclaredTopic_IsFiledAsContractDrift', () => {
    const store = new MeshCollectorStore();
    store.register(descriptor('orders', ['order:create'], [])); // does NOT declare order:cancel

    store.addEvents([event('trace-1', 'span-1', 'orders', 'order:cancel', Date.now())]);

    const issues = store.fleet().issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].classification).toBe('contract-drift');
    expect(issues[0].service).toBe('orders');
    expect(issues[0].topic).toBe('order:cancel');
    expect(issues[0].count).toBe(1);
    // The graph itself is unaffected by the drift - orders still doesn't provide order:cancel.
    expect(store.topic('order:cancel', undefined)!.providers).toEqual([]);
  });

  it('ContractDrift_RegisteredConsumerCallingAnUndeclaredTopic_IsFiledAsContractDrift', () => {
    const store = new MeshCollectorStore();
    store.register(descriptor('payments', ['payments:capture'], []));
    store.register(descriptor('orders', ['order:create'], [])); // does NOT declare payments:capture

    const callerSpan = event('trace-1', 'span-1', 'orders', 'order:create', Date.now());
    const call = event('trace-1', 'span-2', 'payments', 'payments:capture', Date.now() + 1);
    call.parentSpanId = 'span-1';
    store.addEvents([callerSpan, call]);

    const issues = store.fleet().issues;
    const driftIssues = issues.filter((i) => i.classification === 'contract-drift');
    expect(driftIssues).toHaveLength(1);
    expect(driftIssues[0].service).toBe('orders');
    expect(driftIssues[0].topic).toBe('payments:capture');
    expect(store.topic('payments:capture', undefined)!.consumers).toEqual([]); // graph unaffected
  });

  it('ContractDrift_AnonymousNeverRegisteredService_IsNeverFlagged', () => {
    // Spec §4.2: "An anonymous/never-registered service is never flagged - it has no contract to diverge from."
    const store = new MeshCollectorStore();
    store.addEvents([event('trace-1', 'span-1', 'ghost', 'some:topic', Date.now())]);

    expect(store.fleet().issues).toHaveLength(0);
  });

  it('ContractDrift_MergesRepeatOccurrencesByFingerprint', () => {
    const store = new MeshCollectorStore();
    store.register(descriptor('orders', ['order:create'], []));

    store.addEvents([event('trace-1', 'span-1', 'orders', 'order:cancel', 1_000)]);
    store.addEvents([event('trace-2', 'span-2', 'orders', 'order:cancel', 2_000)]);

    const issues = store.fleet().issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].count).toBe(2); // one occurrence per event, merged by the shared fingerprint
    expect(issues[0].firstSeen).toBe(1_000);
    expect(issues[0].lastSeen).toBe(2_000);
  });

  // ---- correlation lookup (mesh:query:correlation) ----

  it('Correlation_GroupsMatchingFlowsByTrace_OrderedByEarliestStart_EventsInStartOrder', () => {
    // One business correlation id spans two distinct traces; a third trace carries a different id.
    const store = new MeshCollectorStore();
    const now = Date.now();
    store.addEvents([
      // trace-b starts later but its events are added first, to prove ordering is by startedAt.
      corrEvent('trace-b', 'b2', 'shipping', 'book', now + 10_000 + 5, 'corr-1'),
      corrEvent('trace-b', 'b1', 'orders', 'ship', now + 10_000, 'corr-1'),
      corrEvent('trace-a', 'a1', 'orders', 'create', now, 'corr-1'),
      corrEvent('trace-a', 'a2', 'payments', 'capture', now + 5, 'corr-1', 'service-unavailable'),
      corrEvent('trace-c', 'c1', 'orders', 'create', now + 20_000, 'other'),
    ]);

    const view = store.correlation('corr-1');

    expect(view).toBeDefined();
    expect(view!.correlationId).toBe('corr-1');
    expect(view!.traces.length).toBe(2);
    // Traces ordered by earliest event start: trace-a (now) before trace-b (now+10s).
    expect(view!.traces[0].traceId).toBe('trace-a');
    expect(view!.traces[1].traceId).toBe('trace-b');
    // Events within a trace in start order (b1 before b2 despite reversed insertion).
    expect(view!.traces[0].events.map((e) => e.spanId)).toEqual(['a1', 'a2']);
    expect(view!.traces[1].events.map((e) => e.spanId)).toEqual(['b1', 'b2']);
    // The per-leg service/topic/status the owner wants to read survives intact.
    expect(view!.traces[0].events[1].service).toBe('payments');
    expect(view!.traces[0].events[1].status).toBe('service-unavailable');
  });

  it('Correlation_ExcludesNullCorrelationEvents_AndReturnsNullWhenNothingMatches', () => {
    // The mesh never fabricates a correlation id: a flow whose entry set no x-correlation-id header simply
    // won't appear in any lookup.
    const store = new MeshCollectorStore();
    store.addEvents([corrEvent('trace-1', 's1', 'orders', 'create', Date.now(), undefined)]);

    expect(store.correlation('corr-1')).toBeUndefined();
  });

  it('CorrelationQueryHandler_EmptyId_BadRequest_UnknownId_NotFound_KnownId_Ok', async () => {
    const store = new MeshCollectorStore();
    store.addEvents([corrEvent('trace-1', 's1', 'orders', 'create', Date.now(), 'corr-1')]);
    const handler = new CorrelationQueryMessageHandler(store);

    expect((await handler.handleAsync({ correlationId: '' })).status).toBe(BenzeneResultStatus.badRequest);
    expect((await handler.handleAsync({ correlationId: 'nope' })).status).toBe(BenzeneResultStatus.notFound);
    const ok = await handler.handleAsync({ correlationId: 'corr-1' });
    expect(ok.status).toBe(BenzeneResultStatus.ok);
    expect(ok.payload.correlationId).toBe('corr-1');
    expect(ok.payload.traces.length).toBe(1);
  });

  // ---- issue feed (mesh:issues), porting docs/specification/conformance/mesh-issue-cases.json ----

  it('IssuesHandler_ServiceIsRequired_BadRequest', async () => {
    const handler = new IssuesMessageHandler(new MeshCollectorStore());
    const result = await handler.handleAsync(batch('', []));
    expect(result.status).toBe(BenzeneResultStatus.badRequest);
  });

  it('IssuesHandler_EmptyBatch_IsTheLivenessAssertion', async () => {
    const store = new MeshCollectorStore();
    const handler = new IssuesMessageHandler(store);
    const result = await handler.handleAsync(batch('orders', []));
    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.payload.accepted).toBe(0); // empty batch accepted, nothing merged
  });

  it('AddIssues_DeltaMergeByFingerprint_ObservableViaFleet', () => {
    // Two flushes of the same fingerprint: counts sum (2+3=5), firstSeen=min, lastSeen=max, exemplars keep
    // the newest, order preserved.
    const store = new MeshCollectorStore();
    const fp = 'aaaa1111aaaa1111aaaa1111aaaa1111';
    expect(store.addIssues(batch('orders', [issue(fp, 'order:create', 2, 9_00, 9_05, ['trace-1'])]))).toBe(1);
    expect(store.addIssues(batch('orders', [issue(fp, 'order:create', 3, 9_10, 9_15, ['trace-2'])]))).toBe(1);

    const issues = store.fleet().issues;
    expect(issues.length).toBe(1);
    expect(issues[0].fingerprint).toBe(fp);
    expect(issues[0].classification).toBe('exception');
    expect(issues[0].service).toBe('orders');
    expect(issues[0].topic).toBe('order:create');
    expect(issues[0].status).toBe('service-unavailable');
    expect(issues[0].count).toBe(5); // deltas merge by summation
    expect(issues[0].firstSeen).toBe(9_00);
    expect(issues[0].lastSeen).toBe(9_15);
    expect(issues[0].exemplarTraceIds).toEqual(['trace-1', 'trace-2']);
  });

  it('AddIssues_InvalidEntriesAreSkipped_NeverRejected', () => {
    // An entry missing its fingerprint is dropped silently; the well-formed sibling is still accepted.
    const store = new MeshCollectorStore();
    const good = 'bbbb2222bbbb2222bbbb2222bbbb2222';
    const accepted = store.addIssues(
      batch('orders', [
        issue('', 'order:create', 1, 9_00, 9_00, [], 'bad-request', 'validation'),
        issue(good, 'order:create', 1, 9_00, 9_00, [], 'bad-request', 'validation'),
      ]),
    );
    expect(accepted).toBe(1);

    const issues = store.fleet().issues;
    expect(issues.length).toBe(1);
    expect(issues[0].fingerprint).toBe(good);
    expect(issues[0].count).toBe(1);
  });

  it('AddIssues_EntryMissingTopic_IsSkipped', () => {
    const store = new MeshCollectorStore();
    const accepted = store.addIssues(batch('orders', [issue('cccc3333cccc3333cccc3333cccc3333', '', 1, 9_00, 9_00)]));
    expect(accepted).toBe(0);
    expect(store.fleet().issues.length).toBe(0);
  });

  it('IssuesFeedAbsence_IsFlaggedOnlyWhenFailureNeedsExplaining', () => {
    // A failing trace with no issue feed flags the gap; once even an empty liveness batch arrives, the gap
    // clears (spec §4.1 failure-gated feed-absence derivation).
    const store = new MeshCollectorStore();
    const evt = event('4bf92f3577b34da6', '00f067aa0ba902b7', 'orders', 'order:create', Date.now(), 'service-unavailable');
    store.addEvents([evt]);

    let orders = store.fleet().services.find((s) => s.service === 'orders')!;
    expect(orders.missingFeeds).toEqual(['descriptor', 'health', 'issues']);

    store.addIssues(batch('orders', [])); // the empty liveness assertion marks the feed wired
    orders = store.fleet().services.find((s) => s.service === 'orders')!;
    expect(orders.missingFeeds).toEqual(['descriptor', 'health']);
  });

  it('IssuesFeedAbsence_NotFlaggedWhenNoFailure', () => {
    // A healthy never-emitting service is indistinguishable from a healthy emitting one - no "issues" marker.
    const store = new MeshCollectorStore();
    store.addEvents([event('trace-1', 'span-1', 'orders', 'order:create', Date.now(), 'ok')]);
    const orders = store.fleet().services.find((s) => s.service === 'orders')!;
    expect(orders.missingFeeds).not.toContain('issues');
  });
});
