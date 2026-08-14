import { IBenzeneResult } from '@benzenejs/abstractions';
import { IMessageHandlerBase } from './IMessageHandlerBase';
import { IRequestMapperThunk } from './IRequestMapperThunk';

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

/**
 * A fully-bound handler ready to execute against a request thunk — the shape the
 * pipeline invokes after routing.
 * Port of the non-generic C# `IMessageHandler` (renamed `IExecutableMessageHandler`
 * since TypeScript cannot overload a type name on arity); the method keeps the C#
 * `HandleAsync` spelling, camelCased like every other method in the port.
 */
export interface IExecutableMessageHandler {
  handleAsync(requestMapperThunk: IRequestMapperThunk): Promise<IBenzeneResult>;
}
