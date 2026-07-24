import { describe, expect, it } from 'vitest';
import { BenzeneResultStatus } from '@benzene/results';
import {
  MeshServiceRegistry,
  MeshServiceRegistryEntry,
  MeshServiceSource,
} from '@benzene/mesh-contracts';
import {
  HttpMeshServiceDispatcher,
  IMeshDispatchEnvironment,
  IMeshServiceDispatcher,
  MeshDispatchEnvelope,
  MeshDispatchGate,
  MeshDispatchMessageHandler,
  MeshDispatchOptions,
  MeshDispatchRequest,
  MeshDispatchResult,
} from '@benzene/mesh-dispatch';

/**
 * Port of test/Benzene.Mesh.Test/MeshDispatchTest.cs (the gate + message-handler classes; the AWS Lambda
 * dispatcher test needs the unported `Benzene.Mesh.Aws.Lambda`). C# kebab status strings map to the port's
 * PascalCase `BenzeneResultStatus` values.
 */

class StubEnvironment implements IMeshDispatchEnvironment {
  constructor(readonly isProduction: boolean) {}
}

class RecordingDispatcher implements IMeshServiceDispatcher {
  entry: MeshServiceRegistryEntry | undefined;
  envelope: MeshDispatchEnvelope | undefined;

  constructor(
    readonly key: string,
    private readonly result: MeshDispatchResult,
  ) {}

  dispatchAsync(entry: MeshServiceRegistryEntry, envelope: MeshDispatchEnvelope): Promise<MeshDispatchResult> {
    this.entry = entry;
    this.envelope = envelope;
    return Promise.resolve(this.result);
  }
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
