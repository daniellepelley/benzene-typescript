/**
 * Minimal port of `System.Security.Claims.Claim` (BCL). The .NET auth stack carries the
 * authenticated caller as a `ClaimsPrincipal`, a BCL type every JWT/OAuth2 library on that platform
 * already produces; JavaScript has no such shared type, so Benzene ports the small slice of
 * `System.Security.Claims` the middleware actually reads (`Claim`, `ClaimsIdentity`,
 * `ClaimsPrincipal`, `ClaimTypes`) here in `@benzene/auth-core` rather than inventing a
 * Benzene-specific principal abstraction. See the README "Claims" note.
 *
 * Only the fields the auth surface uses are carried — `type` and `value`. The BCL `Claim`'s
 * `ValueType`/`Issuer`/`OriginalIssuer`/`Subject`/`Properties` have no consumer in the ported
 * middleware and are intentionally omitted.
 */
export class Claim {
  /** The claim type, e.g. {@link ClaimTypes.role} or a bare JWT claim name like `"department"`. */
  readonly type: string;

  /** The claim value. */
  readonly value: string;

  constructor(type: string, value: string) {
    this.type = type;
    this.value = value;
  }
}
