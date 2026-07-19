/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeContext. */
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';
import { EventBridgeEvent } from 'aws-lambda';

/**
 * The pipeline context for one EventBridge event. EventBridge delivers a SINGLE event per Lambda
 * invocation, so — unlike the SQS/SNS/S3 record contexts — there is no surrounding batch: one event, one
 * context, one DI scope.
 *
 * TYPE-MODEL adaptation: the .NET package models its own `EventBridgeEvent` (to avoid an extra AWS
 * dependency); the port instead uses the ecosystem-native `@types/aws-lambda` `EventBridgeEvent<TDetailType,
 * TDetail>` (the same choice every other AWS adapter here makes). Its fields are `id`, `version`, `account`,
 * `time`, `region`, `resources`, `source`, `"detail-type"` (hyphenated), and `detail` — mapping onto the
 * C# envelope's `Id`/`Source`/`DetailType`/`Detail`. `detail` is a parsed value (`unknown`) rather than a
 * raw `JsonElement`, since the Node runtime hands the event already parsed.
 */
export class EventBridgeContext implements IHasMessageResult {
  constructor(eventBridgeEvent: EventBridgeEvent<string, unknown>) {
    this.event = eventBridgeEvent;
  }

  /** The EventBridge event this context represents. */
  readonly event: EventBridgeEvent<string, unknown>;

  /** The result of handling this event. Set by `EventBridgeMessageMessageHandlerResultSetter`. */
  messageResult!: IMessageResult;
}
