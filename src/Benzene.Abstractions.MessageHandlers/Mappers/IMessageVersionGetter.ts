/** Port of Benzene.Abstractions.MessageHandlers.Mappers.IMessageVersionGetter. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Extracts the payload schema version from a transport-specific message context, so a router can
 * combine it with the topic into the version-aware dispatch key, and so version-aware request/response
 * mapping can pick the right payload schema to cast from/to.
 *
 * @typeParam TContext The transport-specific context type the version is extracted from.
 */
export interface IMessageVersionGetter<TContext> {
  /**
   * Extracts the payload schema version from the given context. Returns the version signalled by the
   * message, or `undefined`/empty if none was signalled - not an error, this means "the topic's default
   * version". Port of C# `string? GetVersion(TContext)`.
   */
  getVersion(context: TContext): string | undefined;
}

/** Container token: a transport registers a per-context version getter, resolved by this interface. */
export const IMessageVersionGetter: ServiceToken<IMessageVersionGetter<unknown>> =
  serviceToken<IMessageVersionGetter<unknown>>('IMessageVersionGetter');
