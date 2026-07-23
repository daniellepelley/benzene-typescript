import { ClaimsPrincipal } from '@benzene/auth-core';

/**
 * Validates the username/password pair carried by an RFC 7617 `Authorization: Basic` header.
 * Implement this against whatever credential store the app actually uses (a secrets manager, an env
 * var for a single service account, a user table) - this package deliberately ships no default
 * implementation, so there is no hardcoded-credential footgun to accidentally deploy.
 *
 * Port of Benzene.Auth.Basic.IBasicAuthCredentialValidator.
 */
export interface IBasicAuthCredentialValidator {
  /**
   * Validates a username/password pair. Returns the authenticated principal on success, or
   * `undefined` on failure (C# `null` maps to `undefined`). Never throw for "wrong credentials" -
   * that's an ordinary `Unauthorized`, not an application error.
   *
   * @param username Everything before the first `:` in the decoded credentials.
   * @param password Everything after the first `:` (may itself contain `:` characters, per RFC 7617).
   */
  validateAsync(username: string, password: string): Promise<ClaimsPrincipal | undefined>;
}
