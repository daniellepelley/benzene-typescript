import { IMessageHandlerBase } from './IMessageHandlerBase';

/**
 * A message handler for a request that produces a response.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandler&lt;TRequest, TResponse&gt;.
 */
export interface IMessageHandler<TRequest, TResponse>
  extends IMessageHandlerBase<TRequest, TResponse> {}

/**
 * A message handler for a request with no response.
 * Port of C# `IMessageHandler<TRequest>` (renamed with a `NoResponse` suffix since
 * TypeScript cannot overload a type name on arity).
 */
export interface IMessageHandlerNoResponse<TRequest> {
  handleAsync(request: TRequest): Promise<void>;
}
