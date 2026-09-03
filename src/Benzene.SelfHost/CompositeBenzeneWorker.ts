import { IBenzeneWorker } from '@benzenejs/abstractions-middleware';

/** Per-worker start bookkeeping: the raw promise plus its observed terminal state. */
interface StartState {
  readonly worker: IBenzeneWorker;
  /** The start promise with its rejection observed (never itself rejects). */
  tracked: Promise<void>;
  faulted: boolean;
  fault?: unknown;
}

/**
 * Aggregates several {@link IBenzeneWorker}s as one, starting and stopping them together.
 * Port of Benzene.SelfHost.CompositeBenzeneWorker.
 *
 * FAULT SUPERVISION (.NET R17 #291): `startAsync` starts every worker in parallel and then races a
 * first-fault signal against all of them settling. A bare `Promise.all` is not enough: it settles on
 * the FIRST rejection but leaves the surviving siblings running with nothing tracking them, and —
 * worse — some real workers (SqsConsumer-shaped) run their full lifetime inline on the promise
 * returned from `startAsync`, which never settles until told to stop, so a sibling's fault (at
 * startup, or mid-lifetime, any time before the composite's own start settles) must not be hidden
 * behind a promise that will never settle. On any worker's fault, the still-running/started
 * siblings are stopped (best-effort — a stop fault never masks the original failure) and the
 * ORIGINAL fault is rethrown, so a partial composite start never leaks running consume loops or
 * open connections (an unstopped worker is only ever stopped on a clean start).
 *
 * HOW A POST-START FAULT SURFACES (the `IBenzeneWorker` contract this follows): the promise
 * returned from a worker's `startAsync` is the fault-observability channel. It may resolve once the
 * worker is running (a push-based worker — Service Bus, Event Hubs) or stay pending for the whole
 * run and only settle on shutdown (a polling worker — SqsConsumer); either way, a worker signals a
 * fault — at startup or mid-lifetime — by REJECTING that promise. While the composite's own
 * `startAsync` is still pending (i.e. at least one sibling runs inline), such a rejection triggers
 * the stop-siblings-and-rethrow supervision above; `BenzeneHost.runWorkerAsync` then observes the
 * composite's rejection and shuts the host down rather than idling (.NET R7-10 #88). A worker whose
 * `startAsync` already RESOLVED cannot reject retroactively — a push-based worker with a
 * mid-lifetime fault must surface it its own way (the ported workers log receive-side faults and
 * keep running, or stop themselves), exactly as in .NET, where a completed `StartAsync` task is
 * equally terminal.
 */
export class CompositeBenzeneWorker implements IBenzeneWorker {
  private readonly workers: readonly IBenzeneWorker[];

  constructor(workers: Iterable<IBenzeneWorker>) {
    // Materialize once. Callers pass a deferred sequence (BenzeneWorkerBuilder.create hands us
    // `apps.map(factory => factory(resolver))`, and every factory news up a fresh worker), so
    // re-enumerating in stopAsync would build a SECOND, never-started worker set and stop those
    // instead - silently skipping every worker's drain/close/commit. `[...workers]` snapshots it.
    this.workers = [...workers];
  }

  async startAsync(cancellationToken?: AbortSignal): Promise<void> {
    // Start every worker (in parallel), observing each one's fault as it happens. safeStart
    // captures a *synchronous* throw as a rejected promise, so one worker throwing before its first
    // await still lets the others start (and get rolled back) rather than aborting the
    // materialization mid-way. Each promise's rejection handler doubles as the "observation" that
    // prevents an unhandled-rejection surfacing later.
    let signalFirstFault!: () => void;
    const firstFault = new Promise<void>((resolve) => {
      signalFirstFault = resolve;
    });

    const started: StartState[] = this.workers.map((worker) => {
      const state: Partial<StartState> & { worker: IBenzeneWorker } = { worker, faulted: false };
      state.tracked = safeStart(worker, cancellationToken).then(
        () => undefined,
        (error) => {
          state.faulted = true;
          state.fault = error;
          signalFirstFault();
        },
      );
      return state as StartState;
    });

    // Race the first-fault signal against every start settling. With zero faults this changes
    // nothing — firstFault never resolves, so all-settled drives the result, and either every
    // worker started cleanly (return) or a fault was already recorded by the time we check.
    await Promise.race([Promise.all(started.map((x) => x.tracked)), firstFault]);

    if (!started.some((x) => x.faulted)) {
      return; // Every worker's startAsync resolved cleanly.
    }

    // At least one sibling has faulted while another may still be starting/running indefinitely —
    // the shape Promise.all alone can never surface. Roll back and rethrow the first fault (in
    // worker order, chosen after rollback like .NET — a fault landing during rollback still counts).
    await CompositeBenzeneWorker.rollbackAsync(started, cancellationToken);
    throw started.find((x) => x.faulted)!.fault;
  }

  /**
   * Stops every worker whose start hasn't already terminally faulted — that covers a worker still
   * starting/running (the long-running shape above) as well as one that already started
   * successfully. Best-effort: a stop fault never masks the original start failure.
   */
  private static async rollbackAsync(
    started: readonly StartState[],
    cancellationToken?: AbortSignal,
  ): Promise<void> {
    for (const state of started) {
      if (!state.faulted) {
        try {
          await state.worker.stopAsync(cancellationToken);
        } catch {
          // Best-effort rollback: don't let a stop fault mask the original start failure.
        }
      }
    }
  }

  async stopAsync(cancellationToken?: AbortSignal): Promise<void> {
    await Promise.all(this.workers.map((x) => x.stopAsync(cancellationToken)));
  }
}

/** Starts a worker, converting a synchronous throw into a rejected promise (.NET `SafeStart`). */
function safeStart(worker: IBenzeneWorker, cancellationToken?: AbortSignal): Promise<void> {
  try {
    return worker.startAsync(cancellationToken);
  } catch (error) {
    return Promise.reject(error);
  }
}
