import { ServiceIdentifier } from '@benzene/abstractions';
import { ITopic } from './ITopic';

/**
 * Describes a message: its topic and request type.
 * Port of Benzene.Abstractions.Messages.IMessageDefinition.
 *
 * C# `Type RequestType` maps to a runtime service identifier (a class constructor
 * or ServiceToken); TypeScript erases DTO types, so the reference is supplied
 * explicitly where C# reads it via reflection. `VoidResult` is the "no type"
 * sentinel, mirroring C# `typeof(Void)`.
 */
export interface IMessageDefinition {
  readonly topic: ITopic;
  readonly requestType: ServiceIdentifier<unknown>;
}
