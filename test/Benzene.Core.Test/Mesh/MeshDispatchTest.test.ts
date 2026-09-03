import { describe, expect, it } from 'vitest';
import { IDisposable, LoggerBase, LogLevel } from '@benzenejs/abstractions';
import { BenzeneResultStatus } from '@benzenejs/results';
import {
  MeshServiceRegistry,
  MeshServiceRegistryEntry,
  MeshServiceSource,
} from '@benzenejs/mesh-contracts';
import {
  HttpMeshServiceDispatcher,
  IMeshDispatchEnvironment,
  IMeshServiceDispatcher,
  MeshDispatchEnvelope,
  MeshDispatchGate,
  MeshDispatchGuardOptions,
  MeshDispatchMessageHandler,
  MeshDispatchOptions,
  MeshDispatchRateLimiter,
  MeshDispatchRequest,
  MeshDispatchResult,
} from '@benzenejs/mesh-dispatch';

/**
 * Port of test/Benzene.Mesh.Test/MeshDispatchTest.cs (the gate + message-handler + rate-limiter +
 * HTTP-dispatcher classes; the AWS Lambda dispatcher test needs the unported
 * `Benzene.Mesh.Aws.Lambda`). Covers the .NET guard set: target-validation-before-charge (#187a),
 * limiter self-prune (#187b) + the prune TOCTOU guard (#254), audit-then-rethrow (#186), audit on
 * the no-dispatcher path (#255), signal propagation (#185, Wave 1's signal-rides-the-request
 * convention), and the response-size cap with UTF-8-safe truncation (#246).
 */

class StubEnvironment implements IMeshDispatchEnvironment {
  constructor(readonly isProduction: boolean) {}
}

class RecordingDispatcher implements IMeshServiceDispatcher {
  entry: MeshServiceRegistryEntry | undefined;
  envelope: MeshDispatchEnvelope | undefined;
  receivedSignal: AbortSignal | undefined;

  constructor(
    readonly key: string,
    private readonly result: MeshDispatchResult,
  ) {}

  dispatchAsync(
    entry: MeshServiceRegistryEntry,
    envelope: MeshDispatchEnvelope,
    cancellationToken?: AbortSignal,
  ): Promise<MeshDispatchResult> {
    this.entry = entry;
    this.envelope = envelope;
    this.receivedSignal = cancellationToken;
    return Promise.resolve(this.result);
  }
}

/** Throws instead of returning, for #186 (audit-then-rethrow on a dispatch failure). */
class ThrowingDispatcher implements IMeshServiceDispatcher {
  constructor(
    readonly key: string,
    private readonly error: Error,
  ) {}

  dispatchAsync(): Promise<MeshDispatchResult> {
    return Promise.reject(this.error);
  }
}

/** Captures formatted log messages, so a test can assert on the audit line's content. */
class RecordingLogger extends LoggerBase {
  readonly messages: string[] = [];

  log(_logLevel: LogLevel, message: string): void {
    this.messages.push(message);
  }

  beginScope(): IDisposable {
    return { dispose() {} };
  }
}

function windowCount(limiter: MeshDispatchRateLimiter): number {
  // The port of the C# suite's private-field reflection on `_windows`.
  return (limiter as unknown as { windows: Map<string, unknown> }).windows.size;
}

describe('MeshDispatchGate', () => {
  it.each([
    [false, false, true], // non-prod, no override -> allowed
    [false, true, true], // non-prod, override -> allowed
    [true, false, false], // prod, no override -> BLOCKED (the safe default)
    [true, true, true], // prod, override -> allowed
  ])('IsAllowed_RespectsEnvironmentAndOption(prod=%s, allow=%s)', (isProduction, allowInProduction, expected) => {
    const options = new MeshDispatchOptions();
    options.allowInProduction = allowInProduction;
    const gate = new MeshDispatchGate(options, new StubEnvironment(isProduction));

    expect(gate.isAllowed).toBe(expected);
  });
});

describe('MeshDispatchMessageHandler', () => {
  function handler(
    isProduction: boolean,
    registry: MeshServiceRegistry,
    ...dispatchers: IMeshServiceDispatcher[]
  ): MeshDispatchMessageHandler {
    const gate = new MeshDispatchGate(new MeshDispatchOptions(), new StubEnvironment(isProduction));
    return new MeshDispatchMessageHandler(gate, registry, dispatchers);
  }

  const httpRegistry = (): MeshServiceRegistry =>
    new MeshServiceRegistry([
      new MeshServiceRegistryEntry('orders', 'https://orders.example/spec', 'https://orders.example/health'),
    ]);

  function request(fields: Partial<MeshDispatchRequest>): MeshDispatchRequest {
    return Object.assign(new MeshDispatchRequest(), fields);
  }

  it('BlockedInProduction_ReturnsForbidden_AndNeverDispatches', async () => {
    const dispatcher = new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('ok', '{}'));
    const h = handler(true, httpRegistry(), dispatcher);

    const result = await h.handleAsync(request({ service: 'orders', topic: 'order:create', body: '{}' }));

    expect(result.status).toBe(BenzeneResultStatus.forbidden);
    expect(result.isSuccessful).toBe(false);
    expect(dispatcher.entry).toBeUndefined(); // the real handler was never invoked
  });

  it('UnknownService_ReturnsNotFound', async () => {
    const h = handler(false, new MeshServiceRegistry([]), new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('ok', '{}')));

    const result = await h.handleAsync(request({ service: 'ghost', topic: 'x' }));

    expect(result.status).toBe(BenzeneResultStatus.notFound);
  });

  it('MissingTopic_ReturnsBadRequest', async () => {
    const h = handler(false, httpRegistry());

    const result = await h.handleAsync(request({ service: 'orders' }));

    expect(result.status).toBe(BenzeneResultStatus.badRequest);
  });

  it('NoDispatcherForSource_ReturnsNotImplemented', async () => {
    const registry = new MeshServiceRegistry([
      new MeshServiceRegistryEntry('orders', '', '', MeshServiceSource.awsLambdaInvoke, { functionName: 'fn' }),
    ]);
    // Only an HTTP dispatcher is registered - nothing handles AwsLambdaInvoke.
    const h = handler(false, registry, new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('ok', '{}')));

    const result = await h.handleAsync(request({ service: 'orders', topic: 'x' }));

    expect(result.status).toBe(BenzeneResultStatus.notImplemented);
  });

  it('HappyPath_DispatchesViaMatchingTransport_AndReturnsTheServiceResponse', async () => {
    const dispatcher = new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('created', '{"id":1}'));
    const h = handler(false, httpRegistry(), dispatcher);

    const result = await h.handleAsync(
      request({ service: 'orders', topic: 'order:create', headers: { k: 'v' }, body: '{"a":1}' }),
    );

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.isSuccessful).toBe(true);
    expect(dispatcher.entry!.name).toBe('orders');
    expect(dispatcher.envelope!.topic).toBe('order:create');
    expect(dispatcher.envelope!.body).toBe('{"a":1}');
    // The service's response envelope is serialized into the payload.
    expect(result.payload.content).toContain('created');
    expect(result.payload.content).toContain('id');
  });
});

describe('HttpMeshServiceDispatcher', () => {
  // Port-verification tests (the C# suite only unit-tested the Lambda dispatcher): the ported HTTP
  // dispatcher's invoke-URL resolution and envelope POST, exercised against a stub `fetch`.
  function stubFetch(status: number, body: string): { fetchFn: typeof fetch; calls: { url: string; init: RequestInit }[] } {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(body, { status }));
    }) as unknown as typeof fetch;
    return { fetchFn, calls };
  }

  it('derives the invoke URL from the specUrl origin as <origin>/benzene-message', async () => {
    const { fetchFn, calls } = stubFetch(200, '{"ok":true}');
    const dispatcher = new HttpMeshServiceDispatcher(fetchFn);
    const entry = new MeshServiceRegistryEntry('orders', 'https://orders.example/some/spec?type=benzene', 'h');

    const result = await dispatcher.dispatchAsync(entry, new MeshDispatchEnvelope('order:create', {}, '{"a":1}'));

    expect(calls[0]!.url).toBe('https://orders.example/benzene-message');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ topic: 'order:create', headers: {}, body: '{"a":1}' });
    expect(result.statusCode).toBe('200');
    expect(result.body).toBe('{"ok":true}');
  });

  it('prefers an explicit invokeUrl from sourceOptions', async () => {
    const { fetchFn, calls } = stubFetch(201, '');
    const dispatcher = new HttpMeshServiceDispatcher(fetchFn);
    const entry = new MeshServiceRegistryEntry('orders', 'https://orders.example/spec', 'h', 'Http', {
      invokeUrl: 'https://gateway.internal/orders/invoke',
    });

    await dispatcher.dispatchAsync(entry, new MeshDispatchEnvelope('t', {}, ''));

    expect(calls[0]!.url).toBe('https://gateway.internal/orders/invoke');
  });

  it('throws when there is neither an invokeUrl nor a specUrl', async () => {
    const dispatcher = new HttpMeshServiceDispatcher(stubFetch(200, '').fetchFn);
    const entry = new MeshServiceRegistryEntry('orders', '', 'h');

    await expect(dispatcher.dispatchAsync(entry, new MeshDispatchEnvelope('t', {}, ''))).rejects.toThrow();
  });
});

describe('MeshDispatchMessageHandler guards', () => {
  const httpRegistry = (): MeshServiceRegistry =>
    new MeshServiceRegistry([
      new MeshServiceRegistryEntry('orders', 'https://orders.example/spec', 'https://orders.example/health'),
    ]);

  function request(fields: Partial<MeshDispatchRequest>): MeshDispatchRequest {
    return Object.assign(new MeshDispatchRequest(), fields);
  }

  function openGate(): MeshDispatchGate {
    return new MeshDispatchGate(new MeshDispatchOptions(), new StubEnvironment(false));
  }

  // --- #187a: validate the target before charging the per-target rate limit ---

  it('UnknownService_RepeatedCalls_NeverChargeTheRateLimiter', async () => {
    // Before #187a, the limiter was charged BEFORE the not-found check, so an arbitrary,
    // never-registered service name could pin a permanent rate-limit window. With the check moved
    // first, a not-found service costs the limiter nothing - two calls against a limit of 1 both
    // still return not-found, never rate-limited.
    const guardOptions = new MeshDispatchGuardOptions();
    guardOptions.maxPerMinutePerTarget = 1;
    const limiter = new MeshDispatchRateLimiter();
    const h = new MeshDispatchMessageHandler(
      openGate(), new MeshServiceRegistry([]), [], guardOptions, limiter);
    const req = request({ service: 'ghost', topic: 'x' });

    const first = await h.handleAsync(req);
    const second = await h.handleAsync(req);

    expect(first.status).toBe(BenzeneResultStatus.notFound);
    expect(second.status).toBe(BenzeneResultStatus.notFound);
  });

  it('UnregisteredServiceNames_AreRejected_WithoutEverChargingTheRateLimiterWindow', async () => {
    const limiter = new MeshDispatchRateLimiter();
    const h = new MeshDispatchMessageHandler(
      openGate(), new MeshServiceRegistry([]),
      [new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('ok', '{}'))],
      undefined, limiter);

    for (let i = 0; i < 500; i++) {
      const result = await h.handleAsync(request({ service: `ghost-${i}`, topic: 'x' }));
      expect(result.status).toBe(BenzeneResultStatus.notFound);
    }

    expect(windowCount(limiter)).toBe(0);
  });

  // --- the per-target bound itself ---

  it('PastThePerTargetLimit_RefusesWithTooManyRequests_AndAudits', async () => {
    const guardOptions = new MeshDispatchGuardOptions();
    guardOptions.maxPerMinutePerTarget = 2;
    const limiter = new MeshDispatchRateLimiter();
    const logger = new RecordingLogger();
    const dispatcher = new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('ok', '{}'));
    const h = new MeshDispatchMessageHandler(
      openGate(), httpRegistry(), [dispatcher], guardOptions, limiter, undefined, logger);
    const req = request({ service: 'orders', topic: 'order:create', body: '{}' });

    expect((await h.handleAsync(req)).status).toBe(BenzeneResultStatus.ok);
    expect((await h.handleAsync(req)).status).toBe(BenzeneResultStatus.ok);
    const refused = await h.handleAsync(req);

    expect(refused.status).toBe(BenzeneResultStatus.tooManyRequests);
    expect(refused.errors?.map((e) => e.message).join(' ')).toContain('Try again in');
    expect(logger.messages.filter((m) => m.includes('outcome=rate-limited'))).toHaveLength(1);
  });

  // --- #186: a thrown dispatch is audited, then rethrown untouched ---

  it('DispatchThrows_AuditsDispatchFailedWithErrorType_ThenRethrows', async () => {
    const thrown = new RangeError('target is unreachable');
    const dispatcher = new ThrowingDispatcher(MeshServiceSource.http, thrown);
    const logger = new RecordingLogger();
    const h = new MeshDispatchMessageHandler(
      openGate(), httpRegistry(), [dispatcher], undefined, undefined, undefined, logger);

    // Propagation semantics are unchanged - the SAME error surfaces, not swallowed or wrapped.
    // (Audit-and-return was explicitly rejected in .NET.)
    await expect(
      h.handleAsync(request({ service: 'orders', topic: 'order:create', body: '{}' })),
    ).rejects.toBe(thrown);

    // ...but every other exit path audits, and now this one does too.
    expect(logger.messages).toHaveLength(1);
    expect(logger.messages[0]).toContain('outcome=dispatch-failed');
    expect(logger.messages[0]).toContain('exceptionType=RangeError');
  });

  // --- #255: the no-dispatcher misconfiguration leaves an audit record like every other exit ---

  it('NoDispatcherRegisteredForSource_StillLeavesAnAuditRecord', async () => {
    const logger = new RecordingLogger();
    const registry = new MeshServiceRegistry([
      new MeshServiceRegistryEntry('orders', '', '', MeshServiceSource.awsLambdaInvoke, { functionName: 'fn' }),
    ]);
    // Zero IMeshServiceDispatchers supplied - nothing handles AwsLambdaInvoke.
    const h = new MeshDispatchMessageHandler(
      openGate(), registry, [], undefined, undefined, undefined, logger);

    const result = await h.handleAsync(request({ service: 'orders', topic: 'x' }));

    expect(result.status).toBe(BenzeneResultStatus.notImplemented);
    // Exactly one audit entry, under its own outcome label - not the silent zero-log vanishing act
    // the unfixed handler produced for this one misconfiguration class.
    const audits = logger.messages.filter((m) => m.includes('outcome=no-dispatcher') && m.includes('orders'));
    expect(audits).toHaveLength(1);
  });

  // --- #185: the dispatch observes the request's abort signal (Wave 1's structural convention) ---

  it('PassesTheRequestsAbortSignalToTheDispatcher', async () => {
    const dispatcher = new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('ok', '{}'));
    const h = new MeshDispatchMessageHandler(openGate(), httpRegistry(), [dispatcher]);
    const controller = new AbortController();

    const req = request({ service: 'orders', topic: 'order:create' });
    req.signal = controller.signal;
    await h.handleAsync(req);

    // The live signal at the point of use - not undefined.
    expect(dispatcher.receivedSignal).toBe(controller.signal);
  });

  it('NoSignalOnTheRequest_DispatchObservesNoCancellation', async () => {
    const dispatcher = new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('ok', '{}'));
    const h = new MeshDispatchMessageHandler(openGate(), httpRegistry(), [dispatcher]);

    await h.handleAsync(request({ service: 'orders', topic: 'order:create' }));

    expect(dispatcher.receivedSignal).toBeUndefined();
  });

  it('AHostileJsonSignalField_IsIgnored_NotPassedToTheDispatcher', async () => {
    // The signal member is structural and never part of the wire shape: a caller-supplied JSON body
    // carrying {"signal": {...}} deserializes to a plain object, which must not reach the
    // dispatcher as if it were an AbortSignal.
    const dispatcher = new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('ok', '{}'));
    const h = new MeshDispatchMessageHandler(openGate(), httpRegistry(), [dispatcher]);

    const req = request({ service: 'orders', topic: 'order:create' });
    (req as unknown as { signal: unknown }).signal = { aborted: true };
    await h.handleAsync(req);

    expect(dispatcher.receivedSignal).toBeUndefined();
  });

  // --- audit coverage of the remaining exit paths ---

  it('EveryRefusalPathLeavesItsOwnAuditOutcome', async () => {
    const logger = new RecordingLogger();
    const closedGate = new MeshDispatchGate(new MeshDispatchOptions(), new StubEnvironment(true));
    const blocked = new MeshDispatchMessageHandler(
      closedGate, httpRegistry(), [], undefined, undefined, undefined, logger);
    await blocked.handleAsync(request({ service: 'orders', topic: 'x' }));

    const open = new MeshDispatchMessageHandler(
      openGate(), httpRegistry(), [], undefined, undefined, undefined, logger);
    await open.handleAsync(request({ service: 'orders' })); // bad-request
    await open.handleAsync(request({ service: 'ghost', topic: 'x' })); // not-found

    expect(logger.messages.some((m) => m.includes('outcome=gate-blocked'))).toBe(true);
    expect(logger.messages.some((m) => m.includes('outcome=bad-request'))).toBe(true);
    expect(logger.messages.some((m) => m.includes('outcome=not-found'))).toBe(true);
    // With no identity wired, the audit record states the caller was unattributed.
    expect(logger.messages.every((m) => m.includes('email=(unattributed)'))).toBe(true);
  });

  it('HappyPath_AuditsDispatched', async () => {
    const logger = new RecordingLogger();
    const dispatcher = new RecordingDispatcher(MeshServiceSource.http, new MeshDispatchResult('created', '{}'));
    const h = new MeshDispatchMessageHandler(
      openGate(), httpRegistry(), [dispatcher], undefined, undefined, undefined, logger);

    await h.handleAsync(request({ service: 'orders', topic: 'order:create' }));

    expect(logger.messages).toHaveLength(1);
    expect(logger.messages[0]).toContain('outcome=dispatched');
  });
});

/**
 * #187b: the limiter self-prunes past a size threshold, even with nothing calling `prune()`.
 * Also covers #254, the decide-then-remove race inside `prune()` itself.
 */
describe('MeshDispatchRateLimiter', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);

  it('TryAcquire_SelfPrunesPastThreshold_KeepsTheWindowMapBounded', () => {
    let now = t0;
    const limiter = new MeshDispatchRateLimiter(() => now);

    // Push the map past the self-prune threshold with distinct keys, all landing in the same
    // about-to-be-stale window.
    for (let i = 0; i < 513; i++) {
      limiter.tryAcquire(`target:svc-${i}`, 100);
    }
    expect(windowCount(limiter)).toBe(513);

    // Roll past the window boundary and acquire once more. The limiter must self-prune before
    // adding the new entry, because the map (513) already exceeds the threshold (512).
    now = t0 + 2 * 60_000;
    limiter.tryAcquire('target:new-key', 100);

    // Every stale window is gone - proof the map stayed bounded without an explicit prune() call.
    // (Without the self-prune, this would be 514: 513 stale windows plus the new one.)
    expect(windowCount(limiter)).toBe(1);
  });

  it('Prune_RaceAtTheMinuteBoundary_NeverDeletesAConcurrentlyInstalledFreshWindow', () => {
    // #254 - prune() enumerates the windows and, for each entry it decides (from its enumeration
    // snapshot) is stale, removes it. An unconditional delete-by-key would remove whatever is
    // CURRENTLY stored - even a fresh, still-current-minute window a concurrent tryAcquire
    // installed for the SAME key between prune()'s snapshot read and the removal executing. This
    // reproduces that interleaving deterministically - a Map whose first get/delete touch for the
    // key fires two real tryAcquire calls at t1 - and drives the REAL prune() through it, not a
    // hand-reimplementation of its logic (the port of the C# RaceInjectingComparer test).
    const key = 'target:orders';
    const limit = 2;
    const t1 = t0 + 60_000;
    let now = t0;
    const limiter = new MeshDispatchRateLimiter(() => now);

    // Seed a stale window for `key` from the OLD minute - exactly what prune()'s snapshot reads.
    limiter.tryAcquire(key, limit);

    // Swap the private map for one that injects the race at the decide-vs-remove point.
    const internals = limiter as unknown as { windows: Map<string, unknown> };
    let armed: (() => void) | undefined;
    const fire = (): void => {
      const cb = armed;
      armed = undefined;
      cb?.();
    };
    class RaceInjectingMap extends Map<string, unknown> {
      override get(k: string): unknown {
        if (k === key) fire();
        return super.get(k);
      }
      override delete(k: string): boolean {
        if (k === key) fire();
        return super.delete(k);
      }
    }
    internals.windows = new RaceInjectingMap(internals.windows);

    // Arm the race: the FIRST time prune() touches the map for `key` after its snapshot (i.e.
    // after it has already decided, from the stale window it enumerated, to remove this entry,
    // but strictly before the removal executes), two real tryAcquire calls land for the same key
    // at t1 - the concurrently-installed fresh window.
    armed = () => {
      expect(limiter.tryAcquire(key, limit).allowed).toBe(true); // fresh window(t1, 1)
      expect(limiter.tryAcquire(key, limit).allowed).toBe(true); // window(t1, 2) - at the limit
    };

    now = t1;
    limiter.prune();

    // The window the two concurrent requests built up must survive prune()'s stale-snapshot
    // decision - a third request this minute must be refused, never wrongly re-admitted as if the
    // window had just reset to count=1.
    expect(internals.windows.has(key)).toBe(true);
    expect(limiter.tryAcquire(key, limit).allowed).toBe(false);
  });

  it('TheLimiterRollsWithTheMinute_RatherThanBanningForever', () => {
    let now = t0 + 30_000; // half past the minute
    const limiter = new MeshDispatchRateLimiter(() => now);

    expect(limiter.tryAcquire('k', 1).allowed).toBe(true);
    const refused = limiter.tryAcquire('k', 1);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(30);

    now += 60_000;
    expect(limiter.tryAcquire('k', 1).allowed).toBe(true);
  });

  it('ALimitOfZero_DisablesTheCheckRatherThanRefusingEverything', () => {
    // An operator turning a limit off must get "off", not "nothing gets through" - the opposite
    // reading would be a very quiet outage.
    const limiter = new MeshDispatchRateLimiter(() => t0);
    for (let i = 0; i < 100; i++) {
      expect(limiter.tryAcquire('k', 0).allowed).toBe(true);
    }
  });
});

/** #187 noted gap: the HTTP dispatcher caps the target's response the same way the request side is capped. */
describe('HttpMeshServiceDispatcher response cap', () => {
  const httpEntry = (): MeshServiceRegistryEntry =>
    new MeshServiceRegistryEntry('orders', 'https://orders.example/spec', 'https://orders.example/health');

  function fixedBodyFetch(body: string): typeof fetch {
    return (() => Promise.resolve(new Response(body, { status: 200 }))) as unknown as typeof fetch;
  }

  const dispatch = (dispatcher: HttpMeshServiceDispatcher) =>
    dispatcher.dispatchAsync(httpEntry(), new MeshDispatchEnvelope('t', {}, '{}'));

  it('ResponseWithinCap_ReturnsBodyUnchanged', async () => {
    const body = 'a'.repeat(100);
    const dispatcher = new HttpMeshServiceDispatcher(fixedBodyFetch(body), 1_000);

    const result = await dispatch(dispatcher);

    expect(result.body).toBe(body);
    expect(result.body).not.toContain(HttpMeshServiceDispatcher.TruncatedMarker);
  });

  it('ResponseExceedsCap_TruncatesAndAppendsMarker_RatherThanThrowing', async () => {
    const body = 'b'.repeat(1_000);
    const dispatcher = new HttpMeshServiceDispatcher(fixedBodyFetch(body), 100);

    const result = await dispatch(dispatcher);

    // Truncated at the cap, not thrown: the target DID respond, and the marker is the
    // audit-visible record of what happened rather than losing the response entirely.
    expect(result.body!.startsWith('b'.repeat(100))).toBe(true);
    expect(result.body!.endsWith(HttpMeshServiceDispatcher.TruncatedMarker)).toBe(true);
    expect(result.body!.length).toBe(100 + HttpMeshServiceDispatcher.TruncatedMarker.length);
  });

  it('ResponseExceedsCap_MidMultiByteCharacter_BacksOffToLastCompleteCharacter', async () => {
    // 'é' (U+00E9) is a 2-byte UTF-8 sequence. 60 of them is 120 bytes; a 101-byte cap lands
    // exactly one byte into the 51st character's sequence - a genuine mid-character cut (#246).
    const body = 'é'.repeat(60);
    const dispatcher = new HttpMeshServiceDispatcher(fixedBodyFetch(body), 101);

    const result = await dispatch(dispatcher);

    // Backs off to the 50 complete characters (100 bytes), dropping the dangling lead byte -
    // never a U+FFFD replacement glyph ahead of the marker.
    expect(result.body).toBe('é'.repeat(50) + HttpMeshServiceDispatcher.TruncatedMarker);
    expect(result.body).not.toContain('�');
  });

  it('ResponseExceedsCap_AtCleanMultiByteCharacterBoundary_TruncatesExactlyAtCap', async () => {
    // Same multi-byte body, but a cap (100) that already lands exactly on a character boundary -
    // the fix must not over-trim a genuinely clean cut.
    const body = 'é'.repeat(60);
    const dispatcher = new HttpMeshServiceDispatcher(fixedBodyFetch(body), 100);

    const result = await dispatch(dispatcher);

    expect(result.body).toBe('é'.repeat(50) + HttpMeshServiceDispatcher.TruncatedMarker);
  });

  it('DefaultMaxResponseBytes_MatchesTheRequestSideCapDefault', () => {
    // The response cap defaults to the SAME value as the existing request-side cap - a symmetric
    // bound, not a new arbitrary number.
    expect(HttpMeshServiceDispatcher.DefaultMaxResponseBytes).toBe(
      MeshDispatchGuardOptions.DefaultMaxRequestBytes,
    );
  });

  it('ForwardsTheAbortSignalToFetch', async () => {
    // #185's transport half: the signal handed to dispatchAsync reaches the underlying fetch.
    let seen: AbortSignal | null | undefined = null;
    const fetchFn = ((_url: string, init: RequestInit) => {
      seen = init.signal as AbortSignal | undefined;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
    const dispatcher = new HttpMeshServiceDispatcher(fetchFn);
    const controller = new AbortController();

    await dispatcher.dispatchAsync(httpEntry(), new MeshDispatchEnvelope('t', {}, ''), controller.signal);

    expect(seen).toBe(controller.signal);
  });
});
