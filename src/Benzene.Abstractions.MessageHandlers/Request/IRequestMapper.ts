import { ServiceIdentifier, ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Extracts the request body from a transport context.
 * Port of Benzene.Abstractions.MessageHandlers.Request.IRequestMapper&lt;TContext&gt;.
 *
 * Erasure: C#'s `GetBody<TRequest>` recovers `typeof(TRequest)` at runtime; TypeScript erases `TRequest`,
 * so an optional `targetType` (the handler's request class) may be supplied for mappers that need the
 * runtime type - only `@benzene/core-versioning`'s `CastingRequestMapper` reads it (to pick the upcast
 * caster into the handler's type); every other mapper ignores it. Optional, so existing callers and
 * implementations are unaffected (the same pattern `@benzene/avro`'s deserialize members use).
 */
export interface IRequestMapper<TContext> {
  getBody<TRequest>(context: TContext, targetType?: ServiceIdentifier<unknown>): TRequest | undefined;
}

export const IRequestMapper: ServiceToken<IRequestMapper<unknown>> =
  serviceToken<IRequestMapper<unknown>>('IRequestMapper');
