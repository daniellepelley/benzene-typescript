import { describe, expect, it } from 'vitest';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { HttpMeshTraceExporter, IMeshTraceExporter, MeshTraceEvent } from '@benzene/mesh-wire';

/**
 * Port of Benzene.Test.CloudService.MeshDisposalTest. The mesh singletons (the trace exporter and the
 * CloudService announcer) expose `disposeAsync()` so their background loop / tail-flush can stop on shutdown,
 * plus a synchronous `dispose()` bridge so a synchronously-torn-down container can release them too. These
 * tests lock that in, plus the realization requirement the CloudService wiring relies on: a factory-registered
 * singleton is only disposed once it has been resolved.
 *
 * Divergence from C#: the C# test targets Microsoft DI's throw-on-async-only-disposable behaviour; the port's
 * container has no such throw (JavaScript has no synchronous-disposal-only contract), so the tests assert the
 * port's actual `dispose()` / `disposeAsync()` disposal semantics against the same realized/unrealized cases.
 */

class SpyExporter implements IMeshTraceExporter {
  syncDisposed = false;
  asyncDisposed = false;
  export(_traceEvent: MeshTraceEvent): void {}
  dispose(): void {
    this.syncDisposed = true;
  }
  disposeAsync(): Promise<void> {
    this.asyncDisposed = true;
    return Promise.resolve();
  }
}

describe('MeshDisposal', () => {
  it('disposes a realized exporter on synchronous factory dispose, without throwing', () => {
    const spy = new SpyExporter();
    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonFactory(IMeshTraceExporter, () => spy);
    const factory = container.createServiceResolverFactory();
    factory.createScope().getService(IMeshTraceExporter); // realize, as the CloudService realize-middleware does

    factory.dispose();

    expect(spy.syncDisposed).toBe(true);
  });

  it('disposes a realized exporter on asynchronous factory dispose', async () => {
    const spy = new SpyExporter();
    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonFactory(IMeshTraceExporter, () => spy);
    const factory = container.createServiceResolverFactory();
    factory.createScope().getService(IMeshTraceExporter);

    await factory.disposeAsync!();

    expect(spy.asyncDisposed).toBe(true);
  });

  it('does not dispose an unrealized exporter', () => {
    // Documents why the CloudService wiring must resolve the mesh singletons at least once: a
    // factory-registered singleton that nothing ever resolves is never tracked for disposal.
    const spy = new SpyExporter();
    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonFactory(IMeshTraceExporter, () => spy);
    const factory = container.createServiceResolverFactory();

    factory.dispose();

    expect(spy.syncDisposed).toBe(false);
    expect(spy.asyncDisposed).toBe(false);
  });

  it('HttpMeshTraceExporter sync dispose does not throw and is idempotent with disposeAsync', async () => {
    const exporter = new HttpMeshTraceExporter((url, init) => fetch(url, init), 'http://localhost:1/collector');

    exporter.dispose(); // sync — must not throw
    await exporter.disposeAsync(); // idempotent: a later async disposal just awaits the (finished) pump
  });

  it('disposes a realized HttpMeshTraceExporter on synchronous factory dispose, without throwing', () => {
    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonFactory(
      HttpMeshTraceExporter,
      () => new HttpMeshTraceExporter((url, init) => fetch(url, init), 'http://localhost:1/collector'),
    );
    const factory = container.createServiceResolverFactory();
    factory.createScope().getService(HttpMeshTraceExporter);

    // Realized exactly as CloudService does it — synchronous container disposal must not throw.
    factory.dispose();
  });
});
