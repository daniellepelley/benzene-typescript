import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Extracts the request body from a transport context.
 * Port of Benzene.Abstractions.MessageHandlers.Request.IRequestMapper&lt;TContext&gt;.
 */
export interface IRequestMapper<TContext> {
  getBody<TRequest>(context: TContext): TRequest | undefined;
}

export const IRequestMapper: ServiceToken<IRequestMapper<unknown>> =
  serviceToken<IRequestMapper<unknown>>('IRequestMapper');
