import { describe, expect, it } from 'vitest';
import { CorrelationQueryMessageHandler, MeshCollectorStore } from '@benzene/mesh-collector';
import { MeshTraceEvent } from '@benzene/mesh-wire';
import { BenzeneResultStatus } from '@benzene/results';

/**
 * Port of test/Benzene.Mesh.Test/MeshCollectorStoreTest.cs. Store behaviors the conformance sequences
 * don't pin: the bounded ring window (eviction, with cumulative stats deliberately outliving it), the fleet
 * flow-list cap, consumer derivation, and the correlation lookup. `DateTimeOffset` -> epoch-ms `number`;
 * a null wire status -> `undefined` on `MeshTraceEvent.status`; `null` returns -> `undefined`.
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

  it('Consumers_AreDerivedAtQueryTimeFromParentage', () => {
    const store = new MeshCollectorStore();
    const now = Date.now();
    const parent = event('trace-1', 'span-parent', 'caller', 'outer', now);
    const child = event('trace-1', 'span-child', 'callee', 'inner', now + 1);
    child.parentSpanId = 'span-parent';
    const selfCall = event('trace-2', 'span-self', 'callee', 'inner', now + 2);
    selfCall.parentSpanId = 'span-child'; // same-service parent: no edge

    store.addEvents([parent, child, selfCall]);

    const inner = store.topic('inner', undefined);
    expect(inner).toBeDefined();
    expect(inner!.consumers).toEqual(['caller']);
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
});
