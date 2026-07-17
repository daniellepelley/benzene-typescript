import { IBenzeneResult, IBenzeneResultOf, ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Sends an outbound message and reports only the result status (no typed response payload).
 * Port of Benzene.Abstractions.Messages.IMessageSender&lt;TRequest&gt;.
 *
 * Arity collision: C# overloads `IMessageSender<TRequest>` and `IMessageSender<TRequest, TResponse>`
 * on generic arity, which TypeScript cannot express with one name. Mirroring the handler precedent
 * (`IMessageHandler` kept the two-arg name, the no-response variant became `IMessageHandlerNoResponse`),
 * the two-arg sender keeps `IMessageSender` and this one-arg variant is renamed
 * `IMessageSenderNoResponse`.
 */
export interface IMessageSenderNoResponse<TRequest> {
  /** Port of C# `Task<IBenzeneResult> SendMessageAsync(TRequest message)`. */
  sendMessageAsync(message: TRequest): Promise<IBenzeneResult>;
}

/**
 * Token for resolving a no-response sender from the container. Generic over the request type, so it
 * follows the `<unknown>` token precedent (a container holds at most one sender registration per
 * pipeline, keyed by this token's identity).
 */
export const IMessageSenderNoResponse: ServiceToken<IMessageSenderNoResponse<unknown>> =
  serviceToken<IMessageSenderNoResponse<unknown>>('IMessageSenderNoResponse');

/**
 * Sends an outbound message and returns a typed response payload.
 * Port of Benzene.Abstractions.Messages.IMessageSender&lt;TRequest, TResponse&gt;.
 */
export interface IMessageSender<TRequest, TResponse> {
  /** Port of C# `Task<IBenzeneResult<TResponse>> SendMessageAsync(TRequest request)`. */
  sendMessageAsync(request: TRequest): Promise<IBenzeneResultOf<TResponse>>;
}

/** Token for resolving a typed-response sender from the container (see the `<unknown>` precedent). */
export const IMessageSender: ServiceToken<IMessageSender<unknown, unknown>> =
  serviceToken<IMessageSender<unknown, unknown>>('IMessageSender');
