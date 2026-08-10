/**
 * Thrown by `InProcessDispatcherRegistry.resolve` when `useInProcess(name)` names a pipeline nothing
 * registered via `addInProcessMessaging`.
 * Port of Benzene.Clients.InProcess.InProcessPipelineNotFoundException.
 *
 * PORT DIVERGENCE from .NET: there this is the runtime backstop for a mistake `InProcessRouteStartUpCheck`
 * already catches at start-up. The TypeScript port has no `IStartUpCheck`-equivalent boot-time
 * validation runner (see the package's top-level doc comment), so here this exception is the *only*
 * line of defense, not a backstop for one - it fires on the first dispatch to an unregistered name.
 */
export class InProcessPipelineNotFoundException extends Error {
  /** The pipeline name that was requested but never registered. */
  readonly pipelineName: string;

  constructor(pipelineName: string, registeredNames: readonly string[]) {
    super(buildMessage(pipelineName, registeredNames));
    this.name = 'InProcessPipelineNotFoundException';
    this.pipelineName = pipelineName;
    Object.setPrototypeOf(this, InProcessPipelineNotFoundException.prototype);
  }
}

function buildMessage(pipelineName: string, registeredNames: readonly string[]): string {
  const known =
    registeredNames.length === 0
      ? 'none - addInProcessMessaging(...) was never called'
      : registeredNames.map((n) => `'${n}'`).join(', ');
  return (
    `No in-process pipeline named '${pipelineName}' is registered. Registered pipeline names: ${known}. ` +
    `Add it via addInProcessMessaging(registry => registry.add('${pipelineName}', ...)).`
  );
}
