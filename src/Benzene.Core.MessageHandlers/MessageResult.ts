import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageResult } from '@benzene/abstractions-message-handlers';

/**
 * Port of Benzene.Core.MessageHandlers.MessageResult (and the IDefaultStatuses
 * interface declared in the same C# file).
 */
export interface IDefaultStatuses {
  readonly validationError: string;
  readonly notFound: string;
  readonly badRequest: string;
}

export const IDefaultStatuses: ServiceToken<IDefaultStatuses> =
  serviceToken<IDefaultStatuses>('IDefaultStatuses');

export class MessageResult implements IMessageResult {
  constructor(readonly isSuccessful: boolean) {}
}
