import { describe, expect, it } from 'vitest';
import { Constructor, IBenzeneResult, ISerializer } from '@benzene/abstractions';
import {
  IMessageHandlerResult,
  IMessageTopicGetter,
  IMessageVersionGetter,
  IResponsePayloadMapper,
} from '@benzene/abstractions-message-handlers';
import { IRawStringMessage, ITopic } from '@benzene/abstractions-messages';
import { MessageHandlerDefinition, MessageHandlerResult } from '@benzene/core-message-handlers';
import { Topic } from '@benzene/core-messages';
import { BenzeneResult } from '@benzene/results';
import {
  CastingResponsePayloadMapper,
  ISchemaCasters,
  SchemaCasters,
  SchemaCastersBuilder,
} from '@benzene/core-versioning';
import { V1OrderPayload, V2OrderPayload } from './exampleSchemas';

/** Port of test/Benzene.Core.Test/Core/Versioning/CastingResponsePayloadMapperTest.cs. */

class TestContext {}

class RawResponse implements IRawStringMessage {
  readonly content = 'raw';
}

class FakeResponsePayloadMapper implements IResponsePayloadMapper<TestContext> {
  captured: IMessageHandlerResult | undefined;

  map(_context: TestContext, messageHandlerResult: IMessageHandlerResult): string | undefined {
    this.captured = messageHandlerResult;
    return 'SERIALIZED';
  }
}

const nullSerializer: ISerializer = {
  serialize: () => '',
  deserialize: () => undefined,
};

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
      .add<V2OrderPayload, V1OrderPayload>(V2OrderPayload, V1OrderPayload, 'order', 'V2', 'V1', (f) => {
        const t = new V1OrderPayload();
        t.id = f.id;
        t.quantity = f.quantity;
        return t;
      })
      .build(),
  );
}

const anyCtor = Object as unknown as Constructor<unknown>;

function resultWith(benzeneResult: IBenzeneResult, responseType: Constructor<unknown>): IMessageHandlerResult {
  const definition = MessageHandlerDefinition.createInstance('order', anyCtor, responseType, anyCtor);
  return new MessageHandlerResult(new Topic('order'), definition, benzeneResult);
}

function map(
  inner: FakeResponsePayloadMapper,
  version: IMessageVersionGetter<TestContext>,
  topic: IMessageTopicGetter<TestContext>,
  schemaCasters: ISchemaCasters | undefined,
  result: IMessageHandlerResult,
): string | undefined {
  return new CastingResponsePayloadMapper<TestContext>(inner, version, topic, schemaCasters).map(
    new TestContext(),
    result,
    nullSerializer,
  );
}

describe('CastingResponsePayloadMapper', () => {
  it('Map_SuccessWithRegisteredDowncaster_DowncastsToRequestedVersion', () => {
    const inner = new FakeResponsePayloadMapper();
    const v2 = new V2OrderPayload();
    v2.id = 'order-1';
    v2.quantity = 5;
    v2.currency = 'USD';
    const result = resultWith(BenzeneResult.ok(v2), V2OrderPayload);

    const returned = map(inner, new FakeVersionGetter('V1'), new FakeTopicGetter('order'), casters(), result);

    expect(returned).toBe('SERIALIZED');
    expect(inner.captured!.messageHandlerDefinition!.responseType).toBe(V1OrderPayload);
    const payload = inner.captured!.benzeneResult.payloadAsObject as V1OrderPayload;
    expect(payload).toBeInstanceOf(V1OrderPayload);
    expect(payload.id).toBe('order-1');
    expect(payload.quantity).toBe(5);
    expect(inner.captured!.benzeneResult.status).toBe(result.benzeneResult.status);
    expect(inner.captured!.benzeneResult.isSuccessful).toBe(true);
  });

  it('Map_FailureResult_PassesOriginalResultThrough', () => {
    const inner = new FakeResponsePayloadMapper();
    const result = resultWith(BenzeneResult.validationError<V2OrderPayload>('bad'), V2OrderPayload);

    map(inner, new FakeVersionGetter('V1'), new FakeTopicGetter('order'), casters(), result);

    expect(inner.captured).toBe(result);
  });

  it('Map_NoVersionSignalled_PassesOriginalResultThrough', () => {
    const inner = new FakeResponsePayloadMapper();
    const v2 = new V2OrderPayload();
    v2.id = 'order-1';
    const result = resultWith(BenzeneResult.ok(v2), V2OrderPayload);

    map(inner, new FakeVersionGetter(undefined), new FakeTopicGetter('order'), casters(), result);

    expect(inner.captured).toBe(result);
  });

  it('Map_NoSchemaCasters_PassesOriginalResultThrough', () => {
    const inner = new FakeResponsePayloadMapper();
    const v2 = new V2OrderPayload();
    v2.id = 'order-1';
    const result = resultWith(BenzeneResult.ok(v2), V2OrderPayload);

    map(inner, new FakeVersionGetter('V1'), new FakeTopicGetter('order'), undefined, result);

    expect(inner.captured).toBe(result);
  });

  it('Map_NoDowncasterForRequestedVersion_PassesOriginalResultThrough', () => {
    const inner = new FakeResponsePayloadMapper();
    const v2 = new V2OrderPayload();
    v2.id = 'order-1';
    const result = resultWith(BenzeneResult.ok(v2), V2OrderPayload);

    map(inner, new FakeVersionGetter('V9'), new FakeTopicGetter('order'), casters(), result);

    expect(inner.captured).toBe(result);
  });

  it('Map_NullPayload_PassesOriginalResultThrough', () => {
    const inner = new FakeResponsePayloadMapper();
    const result = resultWith(BenzeneResult.ok<V2OrderPayload>(), V2OrderPayload);

    map(inner, new FakeVersionGetter('V1'), new FakeTopicGetter('order'), casters(), result);

    expect(inner.captured).toBe(result);
  });

  it('Map_RawStringPayload_PassesOriginalResultThrough', () => {
    const inner = new FakeResponsePayloadMapper();
    const result = resultWith(BenzeneResult.ok(new RawResponse()), RawResponse);

    map(inner, new FakeVersionGetter('V1'), new FakeTopicGetter('order'), casters(), result);

    expect(inner.captured).toBe(result);
  });
});
