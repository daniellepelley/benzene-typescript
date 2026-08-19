import { describe, expect, it } from 'vitest';
import {
  IBenzeneResultOf,
  IBenzeneServiceContainer,
  IStartUpCheck,
  serviceToken,
} from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import {
  BenzeneConfiguration,
  BenzeneStartUp,
  IBenzeneApplicationBuilder,
  IBenzeneWorker,
} from '@benzenejs/abstractions-middleware';
import { BenzeneStartUpCheckException, message, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneHost, useWorker } from '@benzenejs/self-host';

/**
 * `BenzeneHost` — the one-line entry point for a self-hosted Benzene worker process, the TypeScript
 * counterpart of .NET's `BenzeneHost.RunAsync<TStartUp>(args)` (test/Benzene.Core.Test/Hosting/
 * BenzeneHostTest.cs). Three things are under test, in ladder order: `build` composes the same public
 * sequence a user would write by hand, `runWorkerAsync` owns start/shutdown/stop for any worker, and
 * `runAsync` is those two together.
 */

/** A recording worker, standing in for a real transport's poll loop. */
class FakeWorker implements IBenzeneWorker {
  started = false;
  stopped = false;
  /** When true, `startAsync` behaves like a polling loop: it resolves only once `stopAsync` runs. */
  constructor(private readonly blocks = false) {}
  private release: (() => void) | undefined;

  startAsync(): Promise<void> {
    this.started = true;
    if (!this.blocks) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  stopAsync(): Promise<void> {
    this.stopped = true;
    this.release?.();
    return Promise.resolve();
  }
}

const IProbe = serviceToken<{ tag: string }>('IProbe');

/** The startup shape a service ships: hosting is declared here, not in the entry point. */
function startUpAdding(worker: IBenzeneWorker): new () => BenzeneStartUp {
  return class implements BenzeneStartUp {
    configureServices(_services: IBenzeneServiceContainer, _c: BenzeneConfiguration): void {}
    configure(app: IBenzeneApplicationBuilder, _c: BenzeneConfiguration): void {
      useWorker(app, (workers) => workers.add(() => worker));
    }
  };
}

describe('BenzeneHost', () => {
  describe('build', () => {
    it('boots the startup and returns a worker that has not been started', () => {
      const worker = new FakeWorker();
      const built = BenzeneHost.build(startUpAdding(worker));

      expect(built).toBeDefined();
      expect(worker.started).toBe(false);
    });

    it("runs the startup's configureServices and configure", async () => {
      const seen: string[] = [];
      class RecordingStartUp implements BenzeneStartUp {
        configureServices(services: IBenzeneServiceContainer, _c: BenzeneConfiguration): void {
          seen.push('configureServices');
          services.addSingletonInstance(IProbe, { tag: 'from-startup' });
        }
        configure(app: IBenzeneApplicationBuilder, _c: BenzeneConfiguration): void {
          seen.push(`configure:${app.platform}`);
        }
      }

      BenzeneHost.build(RecordingStartUp);

      expect(seen).toEqual(['configureServices', 'configure:Worker']);
    });

    it('applies options.configureServices before the startup, so the startup wins', () => {
      let resolved: string | undefined;
      class ReadingStartUp implements BenzeneStartUp {
        configureServices(services: IBenzeneServiceContainer, _c: BenzeneConfiguration): void {
          services.addSingletonInstance(IProbe, { tag: 'from-startup' });
        }
        configure(app: IBenzeneApplicationBuilder, _c: BenzeneConfiguration): void {
          useWorker(app, (workers) =>
            workers.add((factory) => {
              const scope = factory.createScope();
              resolved = scope.getService(IProbe).tag;
              scope.dispose();
              return new FakeWorker();
            }),
          );
        }
      }

      const worker = BenzeneHost.build(ReadingStartUp, {
        configureServices: (services) => services.addSingletonInstance(IProbe, { tag: 'from-options' }),
      });
      // Materializing the worker is what resolves the probe.
      void worker;

      expect(resolved).toBe('from-startup');
    });

    it('threads the startup’s own getConfiguration through both steps', () => {
      const seen: Array<string | undefined> = [];
      class ConfiguredStartUp implements BenzeneStartUp {
        getConfiguration(): BenzeneConfiguration {
          return { get: (key) => (key === 'QUEUE' ? 'orders-in' : undefined) };
        }
        configureServices(_services: IBenzeneServiceContainer, configuration: BenzeneConfiguration): void {
          seen.push(configuration.get('QUEUE'));
        }
        configure(_app: IBenzeneApplicationBuilder, configuration: BenzeneConfiguration): void {
          seen.push(configuration.get('QUEUE'));
        }
      }

      BenzeneHost.build(ConfiguredStartUp);

      expect(seen).toEqual(['orders-in', 'orders-in']);
    });
  });

  describe('build — the start-up checks', () => {
    // The price of the shorthand: whatever it wired is verified before a message is handled. Two
    // handlers on one topic are caught eagerly by the handler registry as `useMessageHandlers` runs
    // (RegistryMessageHandlersFinder), which is one layer earlier than the `DuplicateTopicStartUpCheck`
    // the runner would otherwise catch it with - either way, inside `BenzeneHost.build`, never on the
    // message path.
    it('fails the build when two handlers claim the same topic', () => {
      class Ping {}
      class Pong {}

      @message('orders:create', { register: false, requestType: Ping, responseType: Pong })
      class FirstHandler implements IMessageHandler<Ping, Pong> {
        handleAsync(): Promise<IBenzeneResultOf<Pong>> {
          return Promise.resolve(BenzeneResult.ok<Pong>(new Pong()));
        }
      }

      @message('orders:create', { register: false, requestType: Ping, responseType: Pong })
      class SecondHandler implements IMessageHandler<Ping, Pong> {
        handleAsync(): Promise<IBenzeneResultOf<Pong>> {
          return Promise.resolve(BenzeneResult.ok<Pong>(new Pong()));
        }
      }

      class DuplicateStartUp implements BenzeneStartUp {
        configureServices(_services: IBenzeneServiceContainer, _c: BenzeneConfiguration): void {}
        configure(app: IBenzeneApplicationBuilder, _c: BenzeneConfiguration): void {
          useWorker(app, (workers) => {
            const pipeline = workers.create<unknown>();
            useMessageHandlers(pipeline, FirstHandler, SecondHandler);
            workers.add(() => new FakeWorker());
          });
        }
      }

      let thrown: unknown;
      try {
        BenzeneHost.build(DuplicateStartUp);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain('orders:create');
      expect((thrown as Error).message).toContain('more than one message handler');
    });

    it('surfaces a failing custom check at build time, not on the message path', () => {
      class ExplodingCheck implements IStartUpCheck {
        readonly name = 'exploding';
        check(): void {
          throw new Error('QUEUE_URL is not set');
        }
      }
      class CheckedStartUp implements BenzeneStartUp {
        configureServices(services: IBenzeneServiceContainer, _c: BenzeneConfiguration): void {
          services.addSingletonInstance(IStartUpCheck, new ExplodingCheck());
        }
        configure(app: IBenzeneApplicationBuilder, _c: BenzeneConfiguration): void {
          useWorker(app, (workers) => workers.add(() => new FakeWorker()));
        }
      }

      let thrown: unknown;
      try {
        BenzeneHost.build(CheckedStartUp);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BenzeneStartUpCheckException);
      expect((thrown as BenzeneStartUpCheckException).failedChecks).toEqual(['exploding']);
      expect((thrown as Error).message).toContain('QUEUE_URL is not set');
      // The failure names the way out, not just the problem.
      expect((thrown as Error).message).toContain('addBenzeneStartUpChecks');
    });
  });

  describe('runWorkerAsync', () => {
    // The host runs until it is TOLD to stop. A push-based worker's startAsync resolves as soon as it
    // is listening/subscribed, and that must not be mistaken for "the service is finished".
    it('keeps running after a worker’s startAsync resolves, until shutdown', async () => {
      const worker = new FakeWorker();
      const controller = new AbortController();

      const run = BenzeneHost.runWorkerAsync(worker, {
        signal: controller.signal,
        shutdownSignals: [],
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(worker.started).toBe(true);
      expect(worker.stopped).toBe(false);

      controller.abort();
      await run;

      expect(worker.stopped).toBe(true);
    });

    it('runs a blocking worker until the caller’s signal aborts, then stops it', async () => {
      const worker = new FakeWorker(true);
      const controller = new AbortController();

      const run = BenzeneHost.runWorkerAsync(worker, {
        signal: controller.signal,
        shutdownSignals: [],
      });
      await Promise.resolve();
      expect(worker.started).toBe(true);
      expect(worker.stopped).toBe(false);

      controller.abort();
      await run;

      expect(worker.stopped).toBe(true);
    });

    it('returns immediately when the caller’s signal is already aborted', async () => {
      const worker = new FakeWorker(true);

      await BenzeneHost.runWorkerAsync(worker, {
        signal: AbortSignal.abort(),
        shutdownSignals: [],
      });

      expect(worker.stopped).toBe(true);
    });

    // No signal is passed: a service that cannot start must not sit waiting for a SIGTERM that a
    // crash-looping pod will never send it.
    it('propagates a start-up failure rather than hanging on the shutdown signal', async () => {
      const worker: IBenzeneWorker = {
        startAsync: () => Promise.reject(new Error('broker unreachable')),
        stopAsync: () => Promise.resolve(),
      };

      await expect(
        BenzeneHost.runWorkerAsync(worker, { shutdownSignals: [] }),
      ).rejects.toThrow(/broker unreachable/);
    });

    it('installs and removes its process signal handlers', async () => {
      const before = process.listenerCount('SIGTERM');
      const controller = new AbortController();
      const run = BenzeneHost.runWorkerAsync(new FakeWorker(true), { signal: controller.signal });

      await Promise.resolve();
      expect(process.listenerCount('SIGTERM')).toBe(before + 1);

      controller.abort();
      await run;

      expect(process.listenerCount('SIGTERM')).toBe(before);
    });
  });

  describe('runAsync', () => {
    it('builds the startup and runs it to shutdown — the whole entry point', async () => {
      const worker = new FakeWorker(true);
      const controller = new AbortController();

      const run = BenzeneHost.runAsync(startUpAdding(worker), {
        signal: controller.signal,
        shutdownSignals: [],
      });
      await Promise.resolve();
      expect(worker.started).toBe(true);

      controller.abort();
      await run;

      expect(worker.stopped).toBe(true);
    });
  });
});
