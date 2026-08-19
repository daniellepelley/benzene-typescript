import { IServiceResolverFactory } from '@benzenejs/abstractions';
import { IBenzeneWorker, IMiddlewarePipeline, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { IBenzeneWorkerStartup } from '@benzenejs/self-host';
import { createServer, Server } from 'node:http';
import { addExpress } from './DependencyInjectionExtensions';
import { ExpressContext } from './ExpressContext';
import { middlewareFor } from './BenzeneMiddlewareFactory';

/** Options for {@link useExpress}. */
export interface BenzeneExpressWorkerOptions {
  /** The port to listen on. Defaults to `PORT` from the environment, then `8080`. */
  port?: number;

  /** The interface to bind. Defaults to `0.0.0.0` — every interface, which is what a container wants. */
  host?: string;
}

/**
 * Hosts a Benzene HTTP pipeline as a self-hosted worker: Benzene owns the listener, so HTTP takes its
 * place alongside `useSqs`/`useKafka`/`useRabbitMq` inside one `useWorker(...)` block and one process
 * serves all of them. The TypeScript counterpart of .NET's `UseAspNet` inside `UseWorker`.
 *
 * ```ts
 * configure(app: IBenzeneApplicationBuilder): void {
 *   useWorker(app, (workers) => {
 *     useExpress(workers, { port: 8080 }, (http) => useMessageHandlers(http, PlaceOrderHandler));
 *     useSqs(workers, sqsConfig, sqsFactory, (sqs) => useMessageHandlers(sqs, PlaceOrderHandler));
 *   });
 * }
 * ```
 *
 * Run the startup with `BenzeneHost.runAsync(StartUp)` (`@benzenejs/self-host`) and the entry point is
 * one line.
 *
 * **This is not the same rung as {@link benzene}, and the difference is who owns the server.** Use
 * `benzene(...)` when the process is *your* Express app and Benzene handles some of its routes — it
 * returns ordinary `(req, res, next)` middleware and falls through to your routes for anything it has
 * no handler for. Use `useExpress` when the process is a Benzene service that happens to speak HTTP;
 * a request no handler owns gets a 404, because there is nothing to fall through to.
 *
 * **The explicit form this composes**, one level down, all public API:
 *
 * ```ts
 * workers.register((x) => { addBenzene(x); addExpress(x); });
 * const pipeline = workers.create<ExpressContext>();
 * useMessageHandlers(pipeline, PlaceOrderHandler);
 * const built = pipeline.build();
 * workers.add((factory) => myOwnWorkerAround(createServer(...)));   // your node:http server
 * ```
 *
 * Despite the name there is no runtime dependency on Express here: the listener is `node:http`'s and a
 * raw `IncomingMessage`/`ServerResponse` satisfies the adapter's structural types. The name says which
 * adapter's request/response mapping is in use, not which package must be installed.
 */
export function useExpress(
  app: IBenzeneWorkerStartup,
  options: BenzeneExpressWorkerOptions,
  action: PipelineBuilderAction<ExpressContext>,
): IBenzeneWorkerStartup {
  app.register((x) => {
    addBenzene(x);
    addExpress(x);
  });

  const pipelineBuilder = app.create<ExpressContext>();
  action(pipelineBuilder);
  const pipeline = pipelineBuilder.build();

  app.add((serviceResolverFactory) => new ExpressBenzeneWorker(pipeline, serviceResolverFactory, options));
  return app;
}

/**
 * The `node:http` server that runs a Benzene Express pipeline, started and stopped as an
 * {@link IBenzeneWorker}. Built by {@link useExpress}.
 *
 * `startAsync` resolves once the socket is bound (a bind failure rejects it, so it fails start-up
 * rather than silently serving nothing); `stopAsync` stops accepting, releases idle keep-alive
 * connections so the close can actually complete, and waits for in-flight requests to finish.
 */
export class ExpressBenzeneWorker implements IBenzeneWorker {
  private server: Server | undefined;

  constructor(
    private readonly pipeline: IMiddlewarePipeline<ExpressContext>,
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly options: BenzeneExpressWorkerOptions,
  ) {}

  startAsync(): Promise<void> {
    const handle = middlewareFor(this.pipeline, this.serviceResolverFactory);
    const server = createServer((req, res) => {
      handle(req, res, (err?: unknown) => {
        // Benzene owns this listener, so there is no next middleware to fall through to: an unrouted
        // request is a 404, and a pipeline error that escaped is a 500.
        res.statusCode = err === undefined ? 404 : 500;
        res.end();
      });
    });

    const port = this.options.port ?? Number(process.env['PORT'] ?? 8080);
    const host = this.options.host ?? '0.0.0.0';

    return new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        this.server = server;
        resolve();
      });
    });
  }

  stopAsync(): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return Promise.resolve();
    }
    this.server = undefined;

    return new Promise<void>((resolve, reject) => {
      server.close((err) => (err === undefined ? resolve() : reject(err)));
      // `close` alone waits for keep-alive sockets that will never send another request; releasing the
      // idle ones is what lets a SIGTERM'd pod exit inside its grace period.
      server.closeIdleConnections();
    });
  }
}
