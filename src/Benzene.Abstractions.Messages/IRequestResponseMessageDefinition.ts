import { ServiceIdentifier } from '@benzenejs/abstractions';
import { IMessageDefinition } from './IMessageDefinition';

/**
 * A message definition that also declares a response type.
 * Port of Benzene.Abstractions.Messages.IRequestResponseMessageDefinition.
 */
export interface IRequestResponseMessageDefinition extends IMessageDefinition {
  readonly responseType: ServiceIdentifier<unknown>;
}
