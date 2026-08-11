/**
 * Thrown by {@link InProcessRouteStartUpCheck} when one or more `useInProcess(name)` routes name a pipeline
 * nothing registered via `addInProcessMessaging(...)` — a missing or misspelled pipeline caught at start-up
 * instead of the first time that route is actually sent to.
 * Port of Benzene.Clients.InProcess.MissingInProcessPipelineException.
 */
export class MissingInProcessPipelineException extends Error {
  /** Every pipeline name referenced by a route with no matching registration. */
  readonly missingNames: string[];

  constructor(missingNames: string[], registeredNames: readonly string[]) {
    super(MissingInProcessPipelineException.buildMessage(missingNames, registeredNames));
    this.name = 'MissingInProcessPipelineException';
    this.missingNames = missingNames;
  }

  private static buildMessage(missingNames: string[], registeredNames: readonly string[]): string {
    const missing = missingNames.map((n) => `'${n}'`).join(', ');
    const known =
      registeredNames.length === 0
        ? 'none - addInProcessMessaging(...) was never called'
        : registeredNames.map((n) => `'${n}'`).join(', ');
    return (
      `The following in-process pipeline name(s) are routed to via useInProcess(...) but never ` +
      `registered: ${missing}. Registered pipeline names: ${known}. Add each missing one via ` +
      'addInProcessMessaging(registry => registry.add("name", ...)).'
    );
  }
}
