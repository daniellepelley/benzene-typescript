import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import {
  BenzeneStartUp,
  IBenzeneWorker,
  emptyConfiguration,
} from '@benzenejs/abstractions-middleware';
import { withStartUpChecks } from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { WorkerApplicationBuilder } from './WorkerApplicationBuilder';

/** Options for {@link BenzeneHost.build}. */
export interface BenzeneHostOptions {
  /**
   * Applied to the container **before** the startup's own `configureServices`, so a caller can
   * substitute one of Benzene's baseline services (they are registered `tryAdd`-style: first
   * registration wins). It is deliberately not a way to overrule the startup — the startup is the
   * caller's own code and runs last. Same ordering rule, for the same reason, as .NET's
   * `BenzeneHost.Build(args, configureHost)`.
   */
  configureServices?: (services: IBenzeneServiceContainer) => void;
}

/** Options for {@link BenzeneHost.runAsync} and {@link BenzeneHost.runWorkerAsync}. */
export interface BenzeneRunOptions extends BenzeneHostOptions {
  /** An extra shutdown trigger, in addition to the process signals. Aborting it stops the workers. */
  signal?: AbortSignal;

  /**
   * The process signals that trigger shutdown. Defaults to `['SIGINT', 'SIGTERM']` — Ctrl-C and the
   * signal Kubernetes/ECS send before the grace period. Pass `[]` to install no handlers at all and
   * drive shutdown entirely through {@link signal}.
   */
  shutdownSignals?: readonly NodeJS.Signals[];
}

/**
 * Runs a {@link BenzeneStartUp} as a long-running self-hosted worker process, so a service's entry
 * point is one line:
 *
 * ```ts
 * // main.ts, entire
 * await BenzeneHost.runAsync(OrdersStartUp);
 * ```
 *
 * The point is not the line count. It is that **the startup becomes the only place hosting is
 * described** — transports are declared in `configure` via `useWorker(app, workers => …)`
 * (`useSqs`, `useKafka`, `useRabbitMq`, `useServiceBus`, …), so adding a second one later never
 * touches the entry point. An entry point that names a specific transport is one that has to be
 * rewritten when the service grows another.
 *
 * **The explicit form this composes**, one level down, all public API — write it yourself whenever
 * you need to do something in the middle of it:
 *
 * ```ts
 * const startUp = new OrdersStartUp();
 * const configuration = startUp.getConfiguration?.() ?? emptyConfiguration();
 * const container = new DefaultBenzeneServiceContainer();   // @benzenejs/dependencies
 * startUp.configureServices(container, configuration);
 * const builder = new WorkerApplicationBuilder(container);  // @benzenejs/self-host
 * startUp.configure(builder, configuration);
 * const worker = builder.createWorker(
 *   withStartUpChecks(container.createServiceResolverFactory()),  // @benzenejs/core-message-handlers
 * );
 * await worker.startAsync(signal);
 * ```
 *
 * That is exactly what {@link build} does, and {@link build} hands the {@link IBenzeneWorker} back
 * so you can start and stop it on your own terms — the rung between this and the block above.
 *
 * **When NOT to use it.** This owns the process's lifecycle. If Benzene is one part of a larger
 * process — an Express app you already own, a gRPC `Server`, an AWS Lambda handler — do not run a
 * host at all: mount Benzene into it with `benzene(...)` (`@benzenejs/express`), `useGrpc(...)`
 * (`@benzenejs/grpc`) or `new AwsLambdaHost(StartUp)` (`@benzenejs/aws-lambda-core`).
 *
 * Port of the .NET `Benzene.HostedService.BenzeneHost`. .NET builds over
 * `Host.CreateDefaultBuilder(args)` and registers an `IHostedService`; Node has no generic host, so
 * this owns the signal handling and shutdown ordering directly and takes no `args`.
 */
export class BenzeneHost {
  /**
   * Builds the worker for `startUpFactory` without starting it — the escape hatch, and the seam a
   * test uses. Runs the boot-time wiring checks (`withStartUpChecks`) before returning, so a
   * registration mistake is a start-up failure rather than every message failing to route once the
   * loop is live.
   *
   * @param startUpFactory A no-argument constructor for the startup — the port of C#'s
   *   `where TStartUp : BenzeneStartUp, new()`.
   */
  static build<TStartUp extends BenzeneStartUp>(
    startUpFactory: new () => TStartUp,
    options: BenzeneHostOptions = {},
  ): IBenzeneWorker {
    const startUp = new startUpFactory();
    const configuration = startUp.getConfiguration?.() ?? emptyConfiguration();

    const container = new DefaultBenzeneServiceContainer();
    // Before the startup's own registrations: see BenzeneHostOptions.configureServices.
    options.configureServices?.(container);
    startUp.configureServices(container, configuration);

    const builder = new WorkerApplicationBuilder(container);
    startUp.configure(builder, configuration);

    return builder.createWorker(withStartUpChecks(container.createServiceResolverFactory()));
  }

  /**
   * Builds the worker for `startUpFactory` and runs it until a shutdown signal arrives, then stops it.
   * Composed from {@link build} + {@link runWorkerAsync}; drop to either when you need to do something
   * between the two.
   */
  static async runAsync<TStartUp extends BenzeneStartUp>(
    startUpFactory: new () => TStartUp,
    options: BenzeneRunOptions = {},
  ): Promise<void> {
    await BenzeneHost.runWorkerAsync(BenzeneHost.build(startUpFactory, options), options);
  }

  /**
   * Runs an already-built {@link IBenzeneWorker} until shutdown: installs the shutdown-signal
   * handlers, starts the worker, waits for a shutdown signal, then stops it and removes the handlers.
   * The wait is for the *signal*, not for the workers - `startAsync` resolving means "started", not
   * "finished". A worker that fails to start triggers shutdown itself, so the process never hangs on a
   * signal that will not come.
   *
   * This is the rung for a worker you built some other way — {@link build}, an
   * {@link InlineSelfHostedStartUp}, or a hand-written {@link IBenzeneWorker}. The explicit form it
   * composes is `worker.startAsync(signal)` / `worker.stopAsync()` with your own
   * `process.on('SIGTERM', …)`.
   *
   * A start failure is rethrown once the workers have been stopped.
   */
  static async runWorkerAsync(worker: IBenzeneWorker, options: BenzeneRunOptions = {}): Promise<void> {
    const controller = new AbortController();
    const abort = (): void => {
      controller.abort();
    };

    const signals = options.shutdownSignals ?? (['SIGINT', 'SIGTERM'] as const);
    for (const name of signals) {
      process.on(name, abort);
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted === true) {
      controller.abort();
    }

    const shutdown = new Promise<void>((resolve) => {
      if (controller.signal.aborted) {
        resolve();
        return;
      }
      controller.signal.addEventListener('abort', () => resolve(), { once: true });
    });

    try {
      const running = worker.startAsync(controller.signal);
      // The host runs until it is told to stop, NOT until the workers finish: `startAsync` resolves
      // promptly for a push-based worker (a Kafka consumer, an HTTP listener) and only on shutdown for
      // a polling one, so "all workers resolved" is not a reason to exit. A worker that fails to start
      // is, though - it triggers the same shutdown rather than leaving the process waiting on a signal
      // that will never come.
      running.catch(() => controller.abort());

      await shutdown;
      await worker.stopAsync();
      // Now that stop has run the loops unwind; this rethrows a start failure (already handled above,
      // so it never surfaces as an unhandled rejection) or anything they threw on the way out.
      await running;
    } finally {
      for (const name of signals) {
        process.off(name, abort);
      }
      options.signal?.removeEventListener('abort', abort);
    }
  }
}
