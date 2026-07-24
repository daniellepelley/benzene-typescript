import { ClaimsPrincipal } from '@benzene/auth-core';

const scopeClaimType = 'scope';
const scpClaimType = 'scp';

/**
 * Reads the granted-scopes set off a {@link ClaimsPrincipal}, normalizing the two conventions
 * real-world OAuth2/JWT issuers use (support both, don't pick one): RFC 8693's single space-delimited
 * `scope` claim, and Azure AD's `scp` claim, which itself appears as either a space-delimited string or
 * a JSON array depending on issuer.
 * Port of Benzene.Auth.OAuth2.ScopeClaims (an internal helper - not exported from the package index).
 */
export const ScopeClaims = {
  /**
   * Returns the flat set of scope strings granted to `principal`, merging every `scope` and `scp` claim
   * value present.
   */
  getGrantedScopes(principal: ClaimsPrincipal): Set<string> {
    const granted = new Set<string>();

    for (const claim of principal.findAll(scopeClaimType)) {
      addSpaceDelimited(granted, claim.value);
    }

    for (const claim of principal.findAll(scpClaimType)) {
      addScpValue(granted, claim.value);
    }

    return granted;
  },
};

function addSpaceDelimited(granted: Set<string>, value: string | undefined): void {
  if (value === undefined || value.trim() === '') {
    return;
  }

  for (const scope of value.split(' ')) {
    if (scope !== '') {
      granted.add(scope);
    }
  }
}

function addScpValue(granted: Set<string>, value: string | undefined): void {
  if (value === undefined || value.trim() === '') {
    return;
  }

  if (value.trimStart().startsWith('[')) {
    try {
      const array = JSON.parse(value);
      if (Array.isArray(array)) {
        for (const scope of array) {
          if (typeof scope === 'string' && scope !== '') {
            granted.add(scope);
          }
        }
        return;
      }
    } catch {
      // Not actually valid JSON despite looking like it - fall through and treat it as a plain
      // (space-delimited) string instead of silently discarding the claim.
    }
  }

  addSpaceDelimited(granted, value);
}
