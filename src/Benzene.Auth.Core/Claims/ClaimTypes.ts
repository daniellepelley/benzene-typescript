/**
 * The well-known claim-type URIs from `System.Security.Claims.ClaimTypes` (BCL) that the ported auth
 * surface references. The values are the exact .NET constants so tokens minted by any standard issuer
 * (and the .NET original) line up. Only the subset actually used is ported; add more as consumers
 * need them.
 */
export const ClaimTypes = {
  /** `System.Security.Claims.ClaimTypes.Name` - the default name claim an identity reports as its `name`. */
  name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',

  /** `System.Security.Claims.ClaimTypes.Role` - the default role claim `ClaimsPrincipal.isInRole` reads. */
  role: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',

  /** `System.Security.Claims.ClaimTypes.NameIdentifier` - a stable identifier for the caller (JWT `sub`). */
  nameIdentifier: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',

  /** `System.Security.Claims.ClaimTypes.Email`. */
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
} as const;
