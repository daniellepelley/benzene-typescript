import { ClaimsPrincipal } from './Claims/ClaimsPrincipal';
import { ClaimTypes } from './Claims/ClaimTypes';

/**
 * Reads the granted-role set off a {@link ClaimsPrincipal}, normalizing the claim shapes real-world
 * issuers use for roles: the BCL default ({@link ClaimTypes.role}, which `ClaimsPrincipal.isInRole`
 * reads), and the bare `role`/`roles` claims common in JWTs (Azure AD app roles arrive in a `roles`
 * claim as a JSON array).
 *
 * Port of Benzene.Auth.Core.RoleClaims (an internal helper - not exported from the package index).
 *
 * Unlike OAuth2 scopes (always space-delimited within a single claim), role names can themselves
 * contain spaces, so a role claim value is never space-split - each claim value is one role, except a
 * JSON-array value which is expanded element by element.
 */
export const RoleClaims = {
  /**
   * Returns whether `principal` holds at least one of `anyOfRoles`, checking both the principal's own
   * {@link ClaimsPrincipal.isInRole} (which honors each identity's configured `roleClaimType`) and the
   * normalized role set from the common role claim types.
   */
  isInAnyRole(principal: ClaimsPrincipal, anyOfRoles: readonly string[]): boolean {
    for (const role of anyOfRoles) {
      if (principal.isInRole(role)) {
        return true;
      }
    }

    const granted = RoleClaims.getGrantedRoles(principal);
    return anyOfRoles.some((role) => granted.has(role));
  },

  /** Returns the flat set of role strings granted to `principal`. */
  getGrantedRoles(principal: ClaimsPrincipal): Set<string> {
    const granted = new Set<string>();
    for (const claimType of roleClaimTypes) {
      for (const claim of principal.findAll(claimType)) {
        addValue(granted, claim.value);
      }
    }

    return granted;
  },
};

const roleClaimTypes: readonly string[] = [ClaimTypes.role, 'role', 'roles'];

function addValue(granted: Set<string>, value: string | undefined): void {
  if (value === undefined || value.trim() === '') {
    return;
  }

  // A "roles" claim can arrive as a JSON array (Azure AD's app-roles convention) rather than one
  // claim per role - expand it. Everything else is a single role value, added verbatim.
  if (value.trimStart().startsWith('[')) {
    try {
      const array = JSON.parse(value);
      if (Array.isArray(array)) {
        for (const role of array) {
          if (typeof role === 'string' && role.trim() !== '') {
            granted.add(role.trim());
          }
        }

        return;
      }
    } catch {
      // Not actually valid JSON despite the leading bracket - fall through and treat the whole value
      // as one role rather than silently discarding the claim.
    }
  }

  granted.add(value.trim());
}
