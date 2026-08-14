import { describe, expect, it } from 'vitest';
import { HealthCheckResponse } from '@benzenejs/health-checks-core';
import { IMeshReportPublisher, MeshServiceReport } from '@benzenejs/mesh-contracts';
import {
  MeshSelfReportMiddleware,
  MeshSelfReportOptions,
  MeshSelfReportState,
} from '@benzenejs/mesh-reporting';

/**
 * Port of test/Benzene.Mesh.Test/MeshSelfReportMiddlewareTest.cs. The C# `TaskCompletionSource` "signal"
 * becomes a deferred promise; `Task.Delay` -> a `setTimeout`-backed `delay`. Publishing is fire-and-forget
 * (`_ = PublishBestEffortAsync()`), so the tests wait on the publisher's own signal rather than the
 * `handleAsync` task. `Func<Task<...>>` providers -> `() => Promise<...>`; `TimeSpan` -> ms `number`.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Mirrors C#'s `Signal.Task.WaitAsync(timeout)` - rejects if the publish signal doesn't fire in time. */
function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`timed out after ${ms}ms`);
    }),
  ]);
}

class RecordingMeshReportPublisher implements IMeshReportPublisher {
  signal = deferred();
  lastPublished: MeshServiceReport | undefined;
  publishCount = 0;

  publishAsync(report: MeshServiceReport): Promise<void> {
    this.lastPublished = report;
    this.publishCount++;
    this.signal.resolve();
    return Promise.resolve();
  }
}

class FailingMeshReportPublisher implements IMeshReportPublisher {
  wasCalled = false;

  publishAsync(_report: MeshServiceReport): Promise<void> {
    this.wasCalled = true;
    throw new Error('publish always fails in this test');
  }
}

class StallingMeshReportPublisher implements IMeshReportPublisher {
  constructor(private readonly stall: Promise<void>) {}

  publishAsync(_report: MeshServiceReport): Promise<void> {
    return this.stall;
  }
}

function buildMiddleware(minimumIntervalMs?: number): {
  middleware: MeshSelfReportMiddleware<string>;
  publisher: RecordingMeshReportPublisher;
  state: MeshSelfReportState;
} {
  const publisher = new RecordingMeshReportPublisher();
  const state = new MeshSelfReportState();
  const options = new MeshSelfReportOptions(
    'orders-api',
    () => Promise.resolve<string | undefined>('{"info":{"title":"orders-api"}}'),
    () => Promise.resolve<HealthCheckResponse | undefined>(undefined),
    minimumIntervalMs,
  );
  return { middleware: new MeshSelfReportMiddleware<string>(publisher, options, state), publisher, state };
}

describe('MeshSelfReportMiddleware', () => {
  it('HandleAsync_CallsNext', async () => {
    let nextCalled = false;
    const { middleware } = buildMiddleware();

    await middleware.handleAsync('context', () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(true);
  });

  it('HandleAsync_FirstCall_PublishesOpportunistically', async () => {
    const { middleware, publisher } = buildMiddleware();

    await middleware.handleAsync('context', () => Promise.resolve());
    await withTimeout(publisher.signal.promise, 2000);

    expect(publisher.lastPublished).not.toBeUndefined();
    expect(publisher.lastPublished!.name).toBe('orders-api');
  });

  it('HandleAsync_SecondCallWithinMinimumInterval_DoesNotPublishAgain', async () => {
    const { middleware, publisher } = buildMiddleware(5 * 60 * 1000);

    await middleware.handleAsync('context', () => Promise.resolve());
    await withTimeout(publisher.signal.promise, 2000);
    expect(publisher.publishCount).toBe(1);

    publisher.signal = deferred();
    await middleware.handleAsync('context', () => Promise.resolve());

    // No second signal will ever arrive since the throttle should have skipped this call - a short
    // delay confirms the count didn't advance, rather than asserting on a signal that (correctly) never fires.
    await delay(200);
    expect(publisher.publishCount).toBe(1);
  });

  it('HandleAsync_PublisherThrows_DoesNotPropagate', async () => {
    const publisher = new FailingMeshReportPublisher();
    const options = new MeshSelfReportOptions(
      'orders-api',
      () => Promise.resolve<string | undefined>('{}'),
      () => Promise.resolve<HealthCheckResponse | undefined>(undefined),
    );
    const middleware = new MeshSelfReportMiddleware<string>(publisher, options, new MeshSelfReportState());

    // Should not throw, even though the injected publisher always throws.
    await middleware.handleAsync('context', () => Promise.resolve());
    await delay(200);

    expect(publisher.wasCalled).toBe(true);
  });

  it('HandleAsync_DoesNotBlockOnASlowPublisher', async () => {
    const neverCompletes = deferred();
    const stallingPublisher = new StallingMeshReportPublisher(neverCompletes.promise);
    const options = new MeshSelfReportOptions(
      'orders-api',
      () => Promise.resolve<string | undefined>('{}'),
      () => Promise.resolve<HealthCheckResponse | undefined>(undefined),
    );
    const middleware = new MeshSelfReportMiddleware<string>(stallingPublisher, options, new MeshSelfReportState());

    const marker = Symbol('handle-completed');
    const handleTask = middleware.handleAsync('context', () => Promise.resolve()).then(() => marker);
    const winner = await Promise.race([handleTask, delay(2000).then(() => Symbol('timeout'))]);

    expect(winner).toBe(marker);
  });
});
