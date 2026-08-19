/**
 * Port of Benzene.SelfHost - the platform-neutral self-hosted worker model: register long-running
 * workers against a `WorkerApplicationBuilder`, compose them, and dispatch polled work concurrently
 * with per-key ordering via `BoundedConcurrentDispatcher`.
 *
 * The dispatcher's `System.Threading.Channels` usage is re-created in-package as `BoundedChannel` (Node
 * has no BCL Channels). `Benzene.HostedService` (the .NET generic-host `IHostedService` adapter) has no
 * direct JS counterpart - Node has no generic host - but its user-facing shorthand does: `BenzeneHost`
 * here owns a worker process's start/stop lifecycle, so an entry point is
 * `await BenzeneHost.runAsync(StartUp)`.
 */
export * from './BoundedChannel';
export * from './BoundedConcurrentDispatcher';
export * from './CompositeBenzeneWorker';
export * from './IBenzeneWorkerStartup';
export * from './BenzeneWorkerBuilder';
export * from './WorkerApplicationBuilder';
export * from './InlineSelfHostedStartUp';
export * from './BenzeneHost';
