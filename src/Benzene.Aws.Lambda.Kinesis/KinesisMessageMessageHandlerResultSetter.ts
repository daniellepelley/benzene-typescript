/** Port of Benzene.Aws.Lambda.Kinesis (result setter — see KinesisMessageContext's ADAPTATION note). */
import {
  IMessageHandlerResult,
  IMessageHandlerResultSetter,
} from '@benzene/abstractions-message-handlers';
import { KinesisMessageContext } from './KinesisMessageContext';

/**
 * Records whether a message handler result was successful onto the Kinesis record context. Like the
 * DynamoDB setter (and unlike SNS's `IHasMessageResult`-based one), the context carries a bare
 * `isSuccessful` flag, so this is a plain `IMessageHandlerResultSetter` implementation.
 */
export class KinesisMessageMessageHandlerResultSetter
  implements IMessageHandlerResultSetter<KinesisMessageContext>
{
  setResultAsync(
    context: KinesisMessageContext,
    messageHandlerResult: IMessageHandlerResult,
  ): Promise<void> {
    context.isSuccessful = messageHandlerResult.benzeneResult.isSuccessful;
    return Promise.resolve();
  }
}
