/** Port of Benzene.Aws.Lambda.DynamoDb.DynamoDbMessageMessageHandlerResultSetter. */
import {
  IMessageHandlerResult,
  IMessageHandlerResultSetter,
} from '@benzene/abstractions-message-handlers';
import { DynamoDbRecordContext } from './DynamoDbRecordContext';

/**
 * Records whether a message handler result was successful onto the DynamoDB record context, so
 * `DynamoDbApplication` can stop at the first failed record and report it back to Lambda for redelivery.
 *
 * Unlike SNS, the C# type implements `IMessageHandlerResultSetter<DynamoDbRecordContext>` directly (the
 * context carries a bare `bool? IsSuccessful`, not an `IHasMessageResult`), so this is a plain
 * implementation writing `context.isSuccessful` rather than a `MessageMessageHandlerResultSetterBase`
 * subclass.
 */
export class DynamoDbMessageMessageHandlerResultSetter
  implements IMessageHandlerResultSetter<DynamoDbRecordContext>
{
  setResultAsync(
    context: DynamoDbRecordContext,
    messageHandlerResult: IMessageHandlerResult,
  ): Promise<void> {
    context.isSuccessful = messageHandlerResult.benzeneResult.isSuccessful;
    return Promise.resolve();
  }
}
