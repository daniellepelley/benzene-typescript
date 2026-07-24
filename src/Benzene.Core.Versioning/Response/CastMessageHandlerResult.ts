/** Port of Benzene.Core.Versioning.Response.CastMessageHandlerResult. */
import { IBenzeneResult } from '@benzene/abstractions';
import { IMessageHandlerDefinition, IMessageHandlerResult } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';

/**
 * A shim {@link IMessageHandlerResult} handed to the inner response payload mapper: same topic, status,
 * success and errors as the real result, but carrying the downcast payload and a
 * `ResponseTypeOverrideDefinition` so serialization uses the requested version's type. Lets the response
 * casting decorator reuse the inner mapper's serialization wholesale.
 */
export class CastMessageHandlerResult implements IMessageHandlerResult {
  readonly topic: ITopic | undefined;
  readonly messageHandlerDefinition: IMessageHandlerDefinition | undefined;
  readonly benzeneResult: IBenzeneResult;

  constructor(
    topic: ITopic | undefined,
    definition: IMessageHandlerDefinition,
    original: IBenzeneResult,
    downcastPayload: unknown,
  ) {
    this.topic = topic;
    this.messageHandlerDefinition = definition;
    this.benzeneResult = new CastBenzeneResult(original, downcastPayload);
  }
}

/** Forwards status/success/errors from the original result while substituting the downcast payload. */
class CastBenzeneResult implements IBenzeneResult {
  readonly payloadAsObject: unknown;

  constructor(
    private readonly original: IBenzeneResult,
    payload: unknown,
  ) {
    this.payloadAsObject = payload;
  }

  get status(): string {
    return this.original.status;
  }

  get isSuccessful(): boolean {
    return this.original.isSuccessful;
  }

  get errors(): string[] {
    return this.original.errors;
  }
}
