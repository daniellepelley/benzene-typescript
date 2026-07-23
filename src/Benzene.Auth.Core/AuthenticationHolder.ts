import { ClaimsPrincipal } from './Claims/ClaimsPrincipal';

/**
 * Carries the current message's authenticated {@link ClaimsPrincipal}, set by whichever
 * authentication middleware ran for this message (e.g. `useBasicAuth`) and read back by later
 * pipeline steps - a handler that wants the caller, or a downstream authorization check like
 * `requireRole`/`requirePolicy`.
 *
 * Port of Benzene.Auth.Core.AuthenticationHolder.
 *
 * Registered scoped (one instance per message) - deliberately NOT carried on `TContext`. A context
 * type describes the shape of a transport message; it stays free of optional, cross-cutting state
 * that only some pipelines opt into. Scoped DI state is the seam for that instead - the same
 * "Context purity" pattern `Benzene.Core.MessageHandlers`' `PresetTopicHolder` follows. A pipeline
 * that never adds an authentication middleware never even allocates a holder anyone would look at,
 * and {@link principal} simply stays `undefined`.
 *
 * No interface: app code that wants the caller reads this type directly, same as `PresetTopicHolder`
 * is read directly rather than through an abstraction.
 */
export class AuthenticationHolder {
  /**
   * The authenticated caller for the current message, or `undefined` if no authentication middleware
   * ran, or if the one that ran failed authentication. Port of C# `Principal` (C# `null` maps to
   * `undefined`).
   */
  principal: ClaimsPrincipal | undefined;
}
