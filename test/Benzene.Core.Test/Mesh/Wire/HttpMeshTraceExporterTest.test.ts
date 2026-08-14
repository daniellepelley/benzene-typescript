/**
 * Port of the HttpMeshTraceExporter behavior asserted across Benzene.Test.Mesh.Wire and the mesh
 * disposal test: the exporter batches events into a `mesh:traces` wire envelope, is lossy in every
 * failure mode (a failing send never escapes, a full buffer drops the newest event), flushes its tail
 * on dispose, and its sync `dispose()` neither throws nor conflicts with `disposeAsync()`. `HttpClient`
 * -> an injectable `fetch`; the .NET `System.Threading.Channels` pump -> a bounded buffer + drain loop.
 */
import { describe, expect, it } from 'vitest';
import { HttpMeshTraceExporter, MeshTraceEvent } from '@benzenejs/mesh-wire';

interface Call {
  url: string;
  body: string;
}

function recordingFetch(calls: Call[], opts: { fail?: boolean } = {}) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, body: String(init.body) });
    if (opts.fail) {
      throw new Error('collector unreachable');
    }
    return new Response('', { status: 200 });
  };
}

function event(traceId: string): MeshTraceEvent {
  const traceEvent = new MeshTraceEvent();
  traceEvent.traceId = traceId;
  traceEvent.spanId = 'span';
  traceEvent.topic = 'order:create';
  traceEvent.status = 'ok';
  return traceEvent;
}

const NEVER = 3_600_000; // an effectively-disabled flush interval, so tests drive flushing explicitly

describe('HttpMeshTraceExporter', () => {
  it('batches buffered events into one mesh:traces envelope', async () => {
    const calls: Call[] = [];
    const exporter = new HttpMeshTraceExporter(recordingFetch(calls), 'http://collector/envelope', 64, NEVER);

    exporter.export(event('a'));
    exporter.export(event('b'));
    await exporter.flushAsync();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://collector/envelope');
    const envelope = JSON.parse(calls[0]!.body) as { topic: string; body: string };
    expect(envelope.topic).toBe('mesh:traces');
    const batch = JSON.parse(envelope.body) as { events: { traceId: string }[] };
    expect(batch.events.map((e) => e.traceId)).toEqual(['a', 'b']);

    await exporter.disposeAsync();
  });

  it('is a no-op flush when nothing is buffered', async () => {
    const calls: Call[] = [];
    const exporter = new HttpMeshTraceExporter(recordingFetch(calls), 'http://collector/envelope', 64, NEVER);

    await exporter.flushAsync();

    expect(calls).toHaveLength(0);
    await exporter.disposeAsync();
  });

  it('swallows a failing send (lossy by design) rather than throwing', async () => {
    const calls: Call[] = [];
    const exporter = new HttpMeshTraceExporter(recordingFetch(calls, { fail: true }), 'http://collector/envelope', 64, NEVER);

    exporter.export(event('a'));
    await expect(exporter.flushAsync()).resolves.toBeUndefined();

    expect(calls).toHaveLength(1); // attempted once, dropped, not retried
    await exporter.disposeAsync();
  });

  it('drops the newest event when the buffer is full', async () => {
    const calls: Call[] = [];
    const exporter = new HttpMeshTraceExporter(recordingFetch(calls), 'http://collector/envelope', 64, NEVER, 2);

    exporter.export(event('a'));
    exporter.export(event('b'));
    exporter.export(event('c')); // buffer already at capacity 2 -> dropped
    await exporter.flushAsync();

    const batch = JSON.parse((JSON.parse(calls[0]!.body) as { body: string }).body) as {
      events: { traceId: string }[];
    };
    expect(batch.events.map((e) => e.traceId)).toEqual(['a', 'b']);

    await exporter.disposeAsync();
  });

  it('flushes the tail on disposeAsync', async () => {
    const calls: Call[] = [];
    const exporter = new HttpMeshTraceExporter(recordingFetch(calls), 'http://collector/envelope', 64, NEVER);

    exporter.export(event('a'));
    await exporter.disposeAsync();

    expect(calls).toHaveLength(1);
  });

  it('ignores exports after disposal', async () => {
    const calls: Call[] = [];
    const exporter = new HttpMeshTraceExporter(recordingFetch(calls), 'http://collector/envelope', 64, NEVER);

    await exporter.disposeAsync();
    exporter.export(event('a'));
    await exporter.flushAsync();

    expect(calls).toHaveLength(0);
  });

  it('sync dispose() does not throw and is idempotent with disposeAsync()', async () => {
    const calls: Call[] = [];
    const exporter = new HttpMeshTraceExporter(recordingFetch(calls), 'http://collector/envelope', 64, NEVER);

    expect(() => exporter.dispose()).not.toThrow();
    await expect(exporter.disposeAsync()).resolves.toBeUndefined();
  });
});
