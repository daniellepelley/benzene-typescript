import { ServiceIdentifier, serviceIdentifierName } from '@benzene/abstractions';

/**
 * Thrown by {@link IBenzeneMessageSender.sendAsync} when the outbound route for a topic did not produce
 * a usable `IBenzeneResult` response.
 * Port of Benzene.Clients.OutboundResponseTypeMismatchException.
 *
 * Erasure divergence: the .NET version also fires when the route produced an `IBenzeneResult<T>` of a
 * *different* `T` than the caller's `TResponse` (a reflection check over the closed generic interface).
 * TypeScript erases `TResponse`, so `sendAsync<TRequest, TResponse>` cannot compare the produced payload
 * type against the requested one - the finer mismatch is undetectable and the returned result is cast to
 * `IBenzeneResultOf<TResponse>` as-is. This exception therefore fires only for the coarser case the port
 * *can* detect: the route set no response, or a response that isn't an `IBenzeneResult` at all.
 */
export class OutboundResponseTypeMismatchException extends Error {
  /** The topic that was sent to. */
  readonly topic: string;

  /** The payload type the route actually produced, or `undefined` if it could not be determined. */
  readonly actualResponseType: ServiceIdentifier<unknown> | undefined;

  /** The `TResponse` the caller requested, or `undefined` (erased in the TypeScript port). */
  readonly requestedResponseType: ServiceIdentifier<unknown> | undefined;

  constructor(
    topic: string,
    actualResponseType?: ServiceIdentifier<unknown>,
    requestedResponseType?: ServiceIdentifier<unknown>,
  ) {
    super(buildMessage(topic, actualResponseType, requestedResponseType));
    this.name = 'OutboundResponseTypeMismatchException';
    this.topic = topic;
    this.actualResponseType = actualResponseType;
    this.requestedResponseType = requestedResponseType;
    Object.setPrototypeOf(this, OutboundResponseTypeMismatchException.prototype);
  }
}

function buildMessage(
  topic: string,
  actualResponseType: ServiceIdentifier<unknown> | undefined,
  requestedResponseType: ServiceIdentifier<unknown> | undefined,
): string {
  const requested = requestedResponseType !== undefined ? serviceIdentifierName(requestedResponseType) : 'the requested TResponse';
  if (actualResponseType === undefined) {
    return (
      `Topic '${topic}' produced no IBenzeneResult response (the requested type was ${requested}). ` +
      `Check the route registered for '${topic}' - its pipeline must set an IBenzeneResult on the OutboundContext.`
    );
  }
  return (
    `Topic '${topic}' produced an IBenzeneResult<${serviceIdentifierName(actualResponseType)}>, ` +
    `not the requested ${requested}. Check the route registered for '${topic}'.`
  );
}
