/**
 * Thrown by `InProcessMessagingBuilder`'s internal build step when the same pipeline name was
 * registered via `add(name, configure)` more than once within a single `addInProcessMessaging(...)`
 * call - the in-process counterpart of `DuplicateOutboundRouteException`.
 * Port of Benzene.Clients.InProcess.DuplicateInProcessPipelineException.
 */
export class DuplicateInProcessPipelineException extends Error {
  /** The pipeline name that was registered more than once. */
  readonly pipelineName: string;

  constructor(pipelineName: string) {
    super(
      `In-process pipeline '${pipelineName}' was registered more than once - each name may only be ` +
        'added once per addInProcessMessaging(...) call.',
    );
    this.name = 'DuplicateInProcessPipelineException';
    this.pipelineName = pipelineName;
    Object.setPrototypeOf(this, DuplicateInProcessPipelineException.prototype);
  }
}
