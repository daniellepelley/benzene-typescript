import { describe, expect, it } from 'vitest';
import { ServiceIdentifier } from '@benzene/abstractions';
import {
  IMessageTopicGetter,
  IMessageVersionGetter,
  IRequestMapper,
} from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { CastingRequestMapper, ISchemaCasters, SchemaCasters, SchemaCastersBuilder } from '@benzene/core-versioning';
import { V1OrderPayload, V2OrderPayload } from './exampleSchemas';

/**
 * Port of test/Benzene.Core.Test/Core/Versioning/CastingRequestMapperTest.cs. The C# fake keys its body
 * on the requested runtime `Type`; here the target type arrives as the `targetType` argument threaded
 * through `IRequestMapper.getBody` (the erasure adaptation), which the fake records and keys on.
 */

class TestContext {}

class FakeRequestMapper implements IRequestMapper<TestContext> {
  readonly requestedTypes: ServiceIdentifier<unknown>[] = [];

  constructor(private readonly bodyFor: (type: ServiceIdentifier<unknown> | undefined) => unknown) {}

  getBody<TRequest>(_context: TestContext, targetType?: ServiceIdentifier<unknown>): TRequest | undefined {
    if (targetType !== undefined) {
      this.requestedTypes.push(targetType);
    }
    return this.bodyFor(targetType) as TRequest | undefined;
  }
}

class FakeVersionGetter implements IMessageVersionGetter<TestContext> {
  constructor(private readonly version: string | undefined) {}
  getVersion(): string | undefined {
    return this.version;
  }
}

class FakeTopicGetter implements IMessageTopicGetter<TestContext> {
  constructor(private readonly topic: string | undefined) {}
  getTopic(): ITopic | undefined {
    return this.topic === undefined ? undefined : new Topic(this.topic);
  }
}

function casters(): ISchemaCasters {
  return new SchemaCasters(
    new SchemaCastersBuilder()
      .add<V1OrderPayload, V2OrderPayload>(V1OrderPayload, V2OrderPayload, 'order', 'V1', 'V2', (f) => {
        const t = new V2OrderPayload();
        t.id = f.id;
        t.quantity = f.quantity;
        return t;
      })
      .build(),
  );
}

describe('CastingRequestMapper', () => {
  it('GetBody_VersionSignalledAndCasterRegistered_UpcastsFromIncomingVersion', () => {
    const inner = new FakeRequestMapper((t) => {
      if (t === V1OrderPayload) {
        const v1 = new V1OrderPayload();
        v1.id = 'order-1';
        v1.quantity = 5;
        return v1;
      }
      return undefined;
    });

    const mapper = new CastingRequestMapper<TestContext>(inner, new FakeVersionGetter('V1'), new FakeTopicGetter('order'), casters());

    const result = mapper.getBody<V2OrderPayload>(new TestContext(), V2OrderPayload);

    expect(result).toBeDefined();
    expect(result!.id).toBe('order-1');
    expect(result!.quantity).toBe(5);
    // The inner mapper was asked for the INCOMING version's type (V1), not the handler's V2.
    expect(inner.requestedTypes).toContain(V1OrderPayload);
    expect(inner.requestedTypes).not.toContain(V2OrderPayload);
  });

  it('GetBody_NoSchemaCasters_DelegatesToInnerForTargetType', () => {
    const inner = new FakeRequestMapper(() => {
      const v2 = new V2OrderPayload();
      v2.id = 'order-2';
      return v2;
    });

    const mapper = new CastingRequestMapper<TestContext>(inner, new FakeVersionGetter('V1'), new FakeTopicGetter('order'), undefined);

    const result = mapper.getBody<V2OrderPayload>(new TestContext(), V2OrderPayload);

    expect(result!.id).toBe('order-2');
    expect(inner.requestedTypes).toEqual([V2OrderPayload]);
  });

  it('GetBody_NoVersionSignalled_DelegatesToInnerForTargetType', () => {
    const inner = new FakeRequestMapper(() => {
      const v2 = new V2OrderPayload();
      v2.id = 'order-2';
      return v2;
    });

    const mapper = new CastingRequestMapper<TestContext>(inner, new FakeVersionGetter(undefined), new FakeTopicGetter('order'), casters());

    const result = mapper.getBody<V2OrderPayload>(new TestContext(), V2OrderPayload);

    expect(result!.id).toBe('order-2');
    expect(inner.requestedTypes).toEqual([V2OrderPayload]);
  });

  it('GetBody_NoCasterForThisVersionPair_DelegatesToInnerForTargetType', () => {
    const inner = new FakeRequestMapper(() => {
      const v2 = new V2OrderPayload();
      v2.id = 'order-2';
      return v2;
    });

    const mapper = new CastingRequestMapper<TestContext>(inner, new FakeVersionGetter('V9'), new FakeTopicGetter('order'), casters());

    const result = mapper.getBody<V2OrderPayload>(new TestContext(), V2OrderPayload);

    expect(result!.id).toBe('order-2');
    expect(inner.requestedTypes).toEqual([V2OrderPayload]);
  });

  it('GetBody_NoTopic_DelegatesToInnerForTargetType', () => {
    const inner = new FakeRequestMapper(() => {
      const v2 = new V2OrderPayload();
      v2.id = 'order-2';
      return v2;
    });

    const mapper = new CastingRequestMapper<TestContext>(inner, new FakeVersionGetter('V1'), new FakeTopicGetter(undefined), casters());

    const result = mapper.getBody<V2OrderPayload>(new TestContext(), V2OrderPayload);

    expect(result!.id).toBe('order-2');
    expect(inner.requestedTypes).toEqual([V2OrderPayload]);
  });

  it('GetBody_InnerReturnsNullForIncomingType_ReturnsUndefined', () => {
    const inner = new FakeRequestMapper(() => undefined);

    const mapper = new CastingRequestMapper<TestContext>(inner, new FakeVersionGetter('V1'), new FakeTopicGetter('order'), casters());

    expect(mapper.getBody<V2OrderPayload>(new TestContext(), V2OrderPayload)).toBeUndefined();
  });
});
