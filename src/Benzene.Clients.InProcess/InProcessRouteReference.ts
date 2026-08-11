/**
 * Records that some outbound route called `useInProcess(name)` for {@link pipelineName}.
 * Port of Benzene.Clients.InProcess.InProcessRouteReference.
 *
 * Registered once per `useInProcess(...)`/`useInProcessFanOut(...)` target (as a multi-registered
 * collection service — resolved with `getServices`, not `getService`), so {@link InProcessRouteStartUpCheck}
 * can see every referenced name at start-up without reflecting into the built outbound routing table. The
 * concrete class doubles as its own DI token (as `InProcessDispatcherRegistry` does).
 */
export class InProcessRouteReference {
  constructor(readonly pipelineName: string) {}
}
