import { describe, expect, it } from 'vitest';
import { JsonSerializer } from '@benzene/core-message-handlers';

/** Port of Benzene.Test.Core.Core.Serialization.JsonSerializerTest. */
class ExampleRequestPayload {
  id: number | undefined;
  name: string | undefined;
}

describe('JsonSerializerTest', () => {
  it('Serialize_ByteAndStringPaths_ProduceByteIdenticalJson', () => {
    const serializer = new JsonSerializer();
    const payload = new ExampleRequestPayload();
    payload.id = 42;
    payload.name = 'some-name';

    const expected = serializer.serialize(payload);

    const bytes = serializer.serializeToBytes(payload);
    const actual = new TextDecoder().decode(bytes);

    expect(actual).toBe(expected);
  });

  it('Deserialize_ByteAndStringPaths_ProduceEquivalentObjects', () => {
    const serializer = new JsonSerializer();
    const source = new ExampleRequestPayload();
    source.id = 42;
    source.name = 'some-name';
    const json = serializer.serialize(source);

    const viaString = serializer.deserialize<ExampleRequestPayload>(json);
    const viaBytes = serializer.deserializeFromBytes<ExampleRequestPayload>(
      new TextEncoder().encode(json),
    );

    expect(viaString?.id).toBe(viaBytes?.id);
    expect(viaString?.name).toBe(viaBytes?.name);
  });

  it('Serialize_ThenDeserialize_RoundTrips', () => {
    const serializer = new JsonSerializer();
    const source = new ExampleRequestPayload();
    source.id = 42;
    source.name = 'some-name';

    const roundTripped = serializer.deserialize<ExampleRequestPayload>(
      serializer.serialize(source),
    );

    expect(roundTripped?.id).toBe(42);
    expect(roundTripped?.name).toBe('some-name');
  });
});
