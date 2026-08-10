/**
 * One target of an in-process fan-out: a named pipeline (registered via `addInProcessMessaging`) and
 * the topic to dispatch under *within that pipeline*.
 * Port of Benzene.Clients.InProcess.InProcessFanOutTarget.
 *
 * The topic is per-target, not shared, because Benzene's (topic, version) → at most one handler
 * invariant is enforced process-wide (every named pipeline shares the same underlying handler
 * registry) - see `DuplicateInProcessFanOutTargetException` for why two targets reacting to what is
 * conceptually one event still need two different topic strings.
 */
export class InProcessFanOutTarget {
  constructor(
    /** The in-process pipeline this target dispatches to. */
    readonly pipelineName: string,
    /** The topic to dispatch under, unique among every target in the same fan-out call. */
    readonly topic: string,
  ) {}
}
