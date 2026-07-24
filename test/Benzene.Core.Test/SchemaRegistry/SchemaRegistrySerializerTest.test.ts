import { describe, expect, it } from 'vitest';
import { Constructor, IPayloadSerializer, ISerializer } from '@benzene/abstractions';
import {
  ConfluentWireFormat,
  DelegateSchemaResolver,
  InMemorySchemaRegistryClient,
  ISchemaRegistryClient,
  SchemaCompatibilityMode,
  SchemaDefinition,
  SchemaRegistrar,
  SchemaRegistrySerializer,
} from '@benzene/schema-registry-core';

/**
 * Port of test/Benzene.Core.Test/SchemaRegistry/SchemaRegistrySerializerTest.cs. C#'s `typeof(string)`
 * type key becomes the `String` constructor (`"hi".constructor === String`, `String.name === 'String'`),
 * per the port's type-erasure convention; `Encoding.UTF8` -> `TextEncoder`/`TextDecoder`.
 */

/** A trivial inner serializer (payload is a string, wire form is its UTF-8 bytes) so the framing decorator can be tested without Avro. */
class Utf8StringSerializer implements ISerializer, IPayloadSerializer {
  serialize<T>(payload: T): string {
    return payload as unknown as string;
  }

  deserialize<T>(payload: string): T | undefined {
    return payload as unknown as T;
  }

  serializeToBytes<T>(payload: T): Uint8Array {
    return new TextEncoder().encode(payload as unknown as string);
  }

  deserializeFromBytes<T>(payload: Uint8Array): T | undefined {
    return new TextDecoder().decode(payload) as unknown as T;
  }
}

function registrar(registry: ISchemaRegistryClient): SchemaRegistrar {
  return new SchemaRegistrar(
    registry,
    new DelegateSchemaResolver((t) => new SchemaDefinition(`${t.name}-value`, '{"type":"string"}')),
  );
}

describe('SchemaRegistrySerializer', () => {
  it('Registrar_RegistersSchemas_AndSerializerFramesWithThatId', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.None);
    const serializer = await registrar(registry).createSerializerAsync(new Utf8StringSerializer(), [
      String as unknown as Constructor<unknown>,
    ]);

    const framed = serializer.serializeToBytes('hello');

    const registered = await registry.getLatestAsync('String-value');
    const { schemaId, body } = ConfluentWireFormat.decode(framed);

    expect(schemaId).toBe(registered!.id); // framed with the registered id
    expect(new TextDecoder().decode(body)).toBe('hello');
  });

  it('Serializer_StringPath_RoundTripsThroughBase64Frame', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.None);
    const serializer = await registrar(registry).createSerializerAsync(new Utf8StringSerializer(), [
      String as unknown as Constructor<unknown>,
    ]);

    const text = serializer.serialize('hi'); // Base64 of the framed bytes
    const back = serializer.deserialize<string>(text);

    expect(back).toBe('hi');
  });

  it('Serializer_UnregisteredType_Throws', () => {
    const serializer = new SchemaRegistrySerializer(new Utf8StringSerializer(), new Map());

    expect(() => serializer.serializeToBytes('x')).toThrow();
  });

  it('EnsureCompatible_Throws_WhenSchemaChangedUnderBackward', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.Backward);
    await registry.registerAsync(new SchemaDefinition('String-value', 'v1'));

    // Resolver now yields a different schema for the same subject -> incompatible under Backward.
    const changed = new SchemaRegistrar(
      registry,
      new DelegateSchemaResolver(() => new SchemaDefinition('String-value', 'v2')),
    );

    await expect(
      changed.ensureCompatibleAsync([String as unknown as Constructor<unknown>]),
    ).rejects.toThrow();
  });
});
