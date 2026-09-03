import { describe, expect, it } from 'vitest';
import { IServiceResolver, ServiceIdentifier } from '@benzenejs/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
  IMessageHandlerFactory,
  IMessageHandlerResultSetter,
  IMessageVersionGetter,
  IRequestMapper,
} from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import {
  BenzeneMessageGetter,
  HeaderMessageVersionGetter,
  MessageRouter,
} from '@benzenejs/core-message-handlers';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';

/**
 * Port of test/Benzene.Core.Test/Core/Core/MessageHandling/BenzeneMessageVersionRoutingTest.cs:
 * the BenzeneMessage transport must resolve the payload schema version through the configurable,
 * priority-ordered `IMessageVersionGetter` (default order `benzene-version` > `version` > `x-version`)
 * — not by baking the raw `version` header into the topic in `BenzeneMessageGetter.getTopic`. A
 * topic-getter version is treated as a deliberate preset override that skips the version getter, so
 * hardcoding one there silently defeats the configured header order. The join itself happens inside
 * `BenzeneMessageGetter.getTopic` (.NET task #98) — `MessageRouter` just consumes the already-joined
 * topic — so the version getter is wired into the getter here, not into the router.
 */

async function routeVersionFor(headers: Record<string, string>): Promise<ITopic> {
  const request = new BenzeneMessageRequest();
  request.topic = 'order:create';
  request.headers = headers;
  request.body = '{}';
  const context = new BenzeneMessageContext(request);

  const rawGetter = new BenzeneMessageGetter();
  const versionGetter = new HeaderMessageVersionGetter<BenzeneMessageContext>(rawGetter);
  const resolver: IServiceResolver = {
    getService<T>(identifier: ServiceIdentifier<T>): T {
      throw new Error(`No service registered for ${String(identifier)}`);
    },
    tryGetService<T>(identifier: ServiceIdentifier<T>): T | undefined {
      return identifier === IMessageVersionGetter ? (versionGetter as unknown as T) : undefined;
    },
    getServices<T>(): T[] {
      return [];
    },
    dispose(): void {},
  };
  const getter = new BenzeneMessageGetter(resolver);

  let routed: ITopic | undefined;
  const lookUp: IMessageHandlerDefinitionLookUp = {
    findHandler(topic: ITopic): IMessageHandlerDefinition | undefined {
      routed = topic;
      return undefined;
    },
    getAllHandlers: () => [],
  };

  const router = new MessageRouter<BenzeneMessageContext>(
    { create: () => undefined } as unknown as IMessageHandlerFactory,
    getter,
    lookUp,
    { getBody: () => undefined } as IRequestMapper<BenzeneMessageContext>,
    { setResultAsync: () => Promise.resolve() } as IMessageHandlerResultSetter<BenzeneMessageContext>,
    { notFound: 'not-found', validationError: 'validation-error', badRequest: 'bad-request' },
  );

  await router.handleAsync(context, () => Promise.resolve());
  return routed!;
}

describe('BenzeneMessageVersionRoutingTest', () => {
  it('BenzeneVersionHeaderWinsOverVersionHeader', async () => {
    // Both present: the configured order puts benzene-version first, so it must win. Before the
    // fix, getTopic read the raw "version" header as a preset override and routed to "1".
    const routed = await routeVersionFor({ 'benzene-version': '2', version: '1' });

    expect(routed.id).toBe('order:create');
    expect(routed.version).toBe('2');
  });

  it('VersionHeaderAloneStillResolves', async () => {
    // The common single-header case is unchanged: "version" alone still routes to that version
    // (now via the version getter rather than the hardcoded topic version).
    const routed = await routeVersionFor({ version: '3' });

    expect(routed.version).toBe('3');
  });

  it('NoVersionHeader_LeavesVersionEmpty', async () => {
    const routed = await routeVersionFor({});

    expect(routed.id).toBe('order:create');
    expect(routed.version).toBe('');
  });
});
