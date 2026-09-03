/** Port of Benzene.Mesh.Dispatch.MeshDispatchMessageHandler. */
import { IBenzeneResultOf, ILogger } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { RawStringMessage } from '@benzenejs/core-messages';
import { MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import { IMeshServiceDispatcher } from './IMeshServiceDispatcher';
import { MeshDispatchEnvelope } from './MeshDispatchEnvelope';
import { MeshDispatchGate } from './MeshDispatchGate';
import { MeshDispatchGuardOptions } from './MeshDispatchGuardOptions';
import { MeshDispatchIdentity } from './MeshDispatchIdentity';
import { MeshDispatchRateLimiter } from './MeshDispatchRateLimiter';
import { MeshDispatchRequest } from './MeshDispatchRequest';

/**
 * Serves the `benzene:mesh:dispatch` topic: invokes ONE registered service's real handler with a caller-supplied
 * payload and returns its response. Off unless {@link MeshDispatchGate.isAllowed} (opt-in registration AND
 * non-Production / allowInProduction) - a real handler runs, with real side-effects. Bounded to one
 * declared service, never a shared queue.
 *
 * The guard collaborators are optional so the handler still works when only `useMeshDispatch()` is
 * wired (no HTTP surface, no guard): with no limiter there is no per-target bound and with no
 * identity the audit record says the caller was unattributed — both stated rather than silently
 * skipped.
 *
 * CANCELLATION (.NET #185's ambient `ICancellationTokenAccessor` → Wave 1's signal-rides-the-request
 * convention): the dispatch observes the structural `signal` member on the request — an
 * `AbortSignal` a transport threads onto it (the BenzeneMessage-over-HTTP endpoint threads the HTTP
 * request's client-gone signal onto the envelope request the same way; an app copies it onto the
 * dispatch request via a request enricher, and a direct caller sets it directly). When nothing set
 * one, the dispatch observes no cancellation — identical to the unguarded behaviour. The member is
 * `instanceof`-guarded, so hostile JSON carrying a `"signal"` field is ignored. There is
 * deliberately NO dedicated DispatchTimeout option (.NET rejected it — the fix is signal flow).
 */
export class MeshDispatchMessageHandler implements IMessageHandler<MeshDispatchRequest, RawStringMessage> {
  private readonly dispatchers: IMeshServiceDispatcher[];
  private readonly guardOptions: MeshDispatchGuardOptions;
  private readonly limiter: MeshDispatchRateLimiter;
  private readonly identity: MeshDispatchIdentity;

  constructor(
    private readonly gate: MeshDispatchGate,
    private readonly registry: MeshServiceRegistry,
    dispatchers: Iterable<IMeshServiceDispatcher>,
    guardOptions?: MeshDispatchGuardOptions,
    limiter?: MeshDispatchRateLimiter,
    identity?: MeshDispatchIdentity,
    private readonly logger?: ILogger,
  ) {
    this.dispatchers = [...dispatchers];
    this.guardOptions = guardOptions ?? new MeshDispatchGuardOptions();
    this.limiter = limiter ?? new MeshDispatchRateLimiter();
    this.identity = identity ?? new MeshDispatchIdentity();
  }

  /**
   * The audit record for one dispatch attempt, allowed, refused, or thrown (.NET #186).
   *
   * This is what makes "safer than handing someone a database credential" a property rather than an
   * assertion: a scoped, attributable, single-topic call that leaves a record - including when the
   * dispatch itself throws, which is exactly the scenario a "leaves a record" claim has to survive.
   * It deliberately carries no payload and no response body — an audit trail that copies the data is
   * a second copy of the thing being protected.
   */
  private audit(
    outcome: string,
    service: string | undefined,
    topic: string | undefined,
    exceptionType?: string,
  ): void {
    this.logger?.logInformation(
      `benzene.mesh.dispatch.audit outcome=${outcome} email=${this.identity.email ?? '(unattributed)'} ` +
        `service=${service ?? '(none)'} topic=${topic ?? '(none)'} ` +
        `environment=${this.identity.environment ?? '(unstated)'} exceptionType=${exceptionType ?? '(none)'}`,
    );
  }

  async handleAsync(request: MeshDispatchRequest): Promise<IBenzeneResultOf<RawStringMessage>> {
    if (!this.gate.isAllowed) {
      this.audit('gate-blocked', request?.service, request?.topic);
      return BenzeneResult.forbidden<RawStringMessage>(this.gate.blockedReason);
    }

    if (
      request === undefined ||
      request === null ||
      (request.service ?? '').trim() === '' ||
      (request.topic ?? '').trim() === ''
    ) {
      this.audit('bad-request', request?.service, request?.topic);
      return BenzeneResult.badRequest<RawStringMessage>("A dispatch request needs both a 'service' and a 'topic'.");
    }

    // .NET #187a: resolve the target BEFORE charging the per-target rate limit. Charging first let
    // an arbitrary, nonexistent service name pin a permanent rate-limit window (the key is the raw
    // caller-supplied string) - a not-found response now costs nothing to the limiter's map.
    const service = request.service!;
    const entry = this.registry.services.find((s) => s.name.toLowerCase() === service.toLowerCase());
    if (entry === undefined) {
      this.audit('not-found', service, request.topic);
      return BenzeneResult.notFound<RawStringMessage>(`No service named '${service}' is registered in the mesh.`);
    }

    // THE PER-TARGET BOUND, applied here rather than in the HTTP guard because the target service
    // is inside the body and that layer deliberately does not parse it. Ten people each dispatching
    // politely still add up at one service, and the service is what this protects.
    const acquired = this.limiter.tryAcquire(`target:${service}`, this.guardOptions.maxPerMinutePerTarget);
    if (!acquired.allowed) {
      this.audit('rate-limited', service, request.topic);
      return BenzeneResult.setErrors<RawStringMessage>(
        BenzeneResultStatus.tooManyRequests,
        `This mesh limits dispatches to '${service}' to ${this.guardOptions.maxPerMinutePerTarget} a minute, ` +
          `across everyone. Try again in ${acquired.retryAfterSeconds}s.`,
      );
    }

    const dispatcher = this.dispatchers.find((d) => d.key.toLowerCase() === entry.source.toLowerCase());
    if (dispatcher === undefined) {
      // .NET #255 - this is the routine post-deploy misconfiguration (service registered, but the
      // matching transport dispatcher was never wired into the container), not a hostile input like
      // the branches above - so it must leave the same audit trail every other exit path does,
      // under its own outcome label, rather than vanishing silently from the trail.
      this.audit('no-dispatcher', service, request.topic);
      return BenzeneResult.setErrors<RawStringMessage>(
        BenzeneResultStatus.notImplemented,
        `No dispatcher is registered for source '${entry.source}' (service '${entry.name}'). ` +
          'Register the matching transport dispatcher (e.g. addMeshLambdaDispatcher() for AwsLambdaInvoke).',
      );
    }

    const envelope = new MeshDispatchEnvelope(request.topic!, request.headers ?? {}, request.body ?? '');

    // .NET #185: pass the ambient cancellation signal (see the class doc comment) rather than none,
    // so a stuck dispatch to an unresponsive service is actually interruptible.
    const signal = signalOf(request);

    let result;
    try {
      result = await dispatcher.dispatchAsync(entry, envelope, signal);
    } catch (error) {
      // .NET #186: every other exit path audits before returning; a thrown dispatch must too, or
      // the "leaves a record" claim is false for exactly the case where a record matters most. The
      // error is NOT swallowed - propagation semantics are unchanged, this only adds a log line.
      // (Audit-and-return was explicitly considered and REJECTED in .NET - do not "fix" this into
      // returning a result.)
      this.audit('dispatch-failed', service, request.topic, errorTypeName(error));
      throw error;
    }

    this.audit('dispatched', service, request.topic);
    const json = JSON.stringify(result);
    return BenzeneResult.ok(new RawStringMessage(json));
  }
}

/** Reads the Wave 1 structural abort signal off the request, ignoring anything that is not a real one. */
function signalOf(request: unknown): AbortSignal | undefined {
  const candidate = (request as { signal?: unknown } | null | undefined)?.signal;
  return candidate instanceof AbortSignal ? candidate : undefined;
}

/** The thrown value's constructor name, for the `outcome=dispatch-failed` audit record (.NET #186). */
function errorTypeName(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name;
  }
  return typeof error;
}
