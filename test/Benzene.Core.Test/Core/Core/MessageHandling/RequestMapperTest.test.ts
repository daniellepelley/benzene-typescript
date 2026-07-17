import { describe, expect, it } from 'vitest';
import { IPayloadSerializer, ISerializer } from '@benzene/abstractions';
import { IMessageBodyGetter, IMessageBodyBytesGetter } from '@benzene/abstractions-messages';
import { JsonSerializer, RequestMapper } from '@benzene/core-message-handlers';

/** Port of Benzene.Test.Core.Core.MessageHandling.RequestMapperTest scenarios. */
class TestContext {}

class ExampleRequestPayload {
  name: string | undefined;
}

class FakeBodyGetter implements IMessageBodyGetter<TestContext> {
  constructor(public body: string | undefined = undefined) {}
  getBody(): string | undefined {
    return this.body;
  }
}

class FakeBodyBytesGetter implements IMessageBodyBytesGetter<TestContext> {
  constructor(public bytes: Uint8Array = new Uint8Array()) {}
  getBodyBytes(): Uint8Array {
    return this.bytes;
  }
}

class PlainSerializer implements ISerializer {
  serialize<T>(payload: T): string {
    return String(payload);
  }
  deserialize<T>(payload: string): T {
    const result = new ExampleRequestPayload();
    result.name = payload;
    return result as unknown as T;
  }
}

// Observable so tests can prove which path (string vs. bytes) the mapper actually took.
class RecordingPayloadSerializer implements IPayloadSerializer {
  stringPathCalled = false;
  bytePathCalled = false;

  serialize<T>(payload: T): string {
    return String(payload);
  }
  deserialize<T>(payload: string): T {
    this.stringPathCalled = true;
    const result = new ExampleRequestPayload();
    result.name = payload;
    return result as unknown as T;
  }
  serializeToBytes<T>(payload: T): Uint8Array {
    return new TextEncoder().encode(this.serialize(payload));
  }
  deserializeFromBytes<T>(payload: Uint8Array): T {
    this.bytePathCalled = true;
    const result = new ExampleRequestPayload();
    result.name = new TextDecoder().decode(payload);
    return result as unknown as T;
  }
}

describe('RequestMapperTest', () => {
  it('GetBody_PrefersBytePath_WhenSerializerIsPayloadSerializerAndBytesGetterAvailable', () => {
    const serializer = new RecordingPayloadSerializer();
    const bodyGetter = new FakeBodyGetter('should-not-be-used');
    const bytesGetter = new FakeBodyBytesGetter(new TextEncoder().encode('from-bytes'));

    const mapper = new RequestMapper<TestContext>(bodyGetter, serializer, bytesGetter);
    const result = mapper.getBody<ExampleRequestPayload>(new TestContext());

    expect(serializer.bytePathCalled).toBe(true);
    expect(serializer.stringPathCalled).toBe(false);
    expect(result?.name).toBe('from-bytes');
  });

  it('GetBody_FallsBackToStringPath_WhenSerializerIsNotAPayloadSerializer', () => {
    const bodyGetter = new FakeBodyGetter('from-string');
    const bytesGetter = new FakeBodyBytesGetter(new TextEncoder().encode('from-bytes'));

    const mapper = new RequestMapper<TestContext>(bodyGetter, new PlainSerializer(), bytesGetter);
    const result = mapper.getBody<ExampleRequestPayload>(new TestContext());

    expect(result?.name).toBe('from-string');
  });

  it('GetBody_FallsBackToStringPath_WhenNoBytesGetterRegistered', () => {
    const serializer = new RecordingPayloadSerializer();
    const bodyGetter = new FakeBodyGetter('from-string');

    const mapper = new RequestMapper<TestContext>(bodyGetter, serializer);
    const result = mapper.getBody<ExampleRequestPayload>(new TestContext());

    expect(serializer.stringPathCalled).toBe(true);
    expect(serializer.bytePathCalled).toBe(false);
    expect(result?.name).toBe('from-string');
  });

  it('GetBody_EmptyBytes_ReturnsDefaultInstance', () => {
    const serializer = new RecordingPayloadSerializer();
    const mapper = new RequestMapper<TestContext>(
      new FakeBodyGetter(),
      serializer,
      new FakeBodyBytesGetter(),
    );

    const result = mapper.getBody<ExampleRequestPayload>(new TestContext());

    expect(result).toBeDefined();
    expect(serializer.bytePathCalled).toBe(false);
    expect(serializer.stringPathCalled).toBe(false);
  });

  it('GetBody_JsonBody_RoundTripsThroughSerializer', () => {
    const mapper = new RequestMapper<TestContext>(
      new FakeBodyGetter('{"name":"foo"}'),
      new JsonSerializer(),
    );

    const result = mapper.getBody<ExampleRequestPayload>(new TestContext());

    expect(result?.name).toBe('foo');
  });

  it('GetBody_EmptyStringBody_ReturnsDefaultInstance', () => {
    const mapper = new RequestMapper<TestContext>(new FakeBodyGetter(''), new JsonSerializer());

    const result = mapper.getBody<ExampleRequestPayload>(new TestContext());

    expect(result).toBeDefined();
    expect(result?.name).toBeUndefined();
  });

  it('GetBody_ContextIsRequestContext_ReturnsPreMappedRequestWithoutDeserializing', () => {
    const serializer = new RecordingPayloadSerializer();
    const preMapped = new ExampleRequestPayload();
    preMapped.name = 'pre-mapped';

    // A context that already carries the strongly-typed request (IRequestContext short-circuit).
    const requestContext = { request: preMapped };

    const mapper = new RequestMapper<typeof requestContext>(
      new FakeBodyGetter('should-not-be-used') as unknown as IMessageBodyGetter<typeof requestContext>,
      serializer,
    );

    const result = mapper.getBody<ExampleRequestPayload>(requestContext);

    expect(result).toBe(preMapped);
    expect(serializer.stringPathCalled).toBe(false);
    expect(serializer.bytePathCalled).toBe(false);
  });
});
