import { IMessageHandlerResult, IMessageHandlerResultSetter } from '@benzene/abstractions-message-handlers';
import { SqsMessageContext } from './SqsMessageContext';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsMessageMessageHandlerResultSetter.
 *
 * Records whether a message handler result was successful onto the SQS context, so `SqsApplication`
 * can report failed records back to SQS for retry.
 */
export class SqsMessageMessageHandlerResultSetter
  implements IMessageHandlerResultSetter<SqsMessageContext>
{
  setResultAsync(
    context: SqsMessageContext,
    messageHandlerResult: IMessageHandlerResult,
  ): Promise<void> {
    context.isSuccessful = messageHandlerResult.benzeneResult.isSuccessful;
    return Promise.resolve();
  }
}
