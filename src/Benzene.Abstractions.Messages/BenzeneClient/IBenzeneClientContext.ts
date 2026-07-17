import { IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneClientRequest } from './IBenzeneClientRequest';

/**
 * The per-send context flowing through a client (outbound) middleware pipeline: the immutable request
 * on the way out and the mutable result on the way back.
 * Port of Benzene.Abstractions.Messages.BenzeneClient.IBenzeneClientContext&lt;TRequest, TResponse&gt;.
 */
export interface IBenzeneClientContext<TRequest, TResponse> {
  /** Port of C# `IBenzeneClientRequest<TRequest> Request { get; }`. */
  readonly request: IBenzeneClientRequest<TRequest>;

  /** Port of C# `IBenzeneResult<TResponse> Response { get; set; }`. */
  response: IBenzeneResultOf<TResponse>;
}
