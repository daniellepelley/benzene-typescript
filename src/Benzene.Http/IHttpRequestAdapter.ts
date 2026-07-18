import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { HttpRequest } from './HttpRequest';
import { IHttpContext } from './IHttpContext';

/**
 * Adapts a transport-specific HTTP context into the Benzene `HttpRequest` model, enabling
 * transport-agnostic HTTP processing (routing, header handling).
 * Port of Benzene.Http.IHttpRequestAdapter&lt;TContext&gt;.
 */
export interface IHttpRequestAdapter<TContext extends IHttpContext> {
  /** Maps the transport HTTP context onto a Benzene `HttpRequest`. Port of C# `Map`. */
  map(context: TContext): HttpRequest;
}

export const IHttpRequestAdapter: ServiceToken<IHttpRequestAdapter<IHttpContext>> =
  serviceToken<IHttpRequestAdapter<IHttpContext>>('IHttpRequestAdapter');
