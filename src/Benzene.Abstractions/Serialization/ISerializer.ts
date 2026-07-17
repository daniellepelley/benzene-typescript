import { ServiceToken, serviceToken } from '../DI/ServiceToken';

/**
 * Serializes and deserializes message payloads to and from strings.
 * Port of Benzene.Abstractions.Serialization.ISerializer.
 *
 * The C# overloads taking a runtime `Type` collapse into the generic forms here,
 * since TypeScript deserialization is shape-based rather than type-based.
 */
export interface ISerializer {
  /** Port of C# `string Serialize<T>(T payload)`. */
  serialize<T>(payload: T): string;

  /** Port of C# `T? Deserialize<T>(string payload)`. */
  deserialize<T>(payload: string): T | undefined;
}

export const ISerializer: ServiceToken<ISerializer> = serviceToken<ISerializer>('ISerializer');
