import { Claim } from './Claim';
import { ClaimsIdentity } from './ClaimsIdentity';

/** A claim predicate, as accepted by `ClaimsPrincipal.FindAll(Predicate<Claim>)` / `HasClaim(Predicate<Claim>)`. */
export type ClaimPredicate = (claim: Claim) => boolean;

/**
 * Minimal port of `System.Security.Claims.ClaimsPrincipal` (BCL) - the authenticated caller for a
 * message, an aggregate of one or more {@link ClaimsIdentity}s. See {@link Claim} for why this BCL
 * slice is ported into `@benzene/auth-core`.
 */
export class ClaimsPrincipal {
  /** The identities that make up this principal. Port of `ClaimsPrincipal.Identities`. */
  readonly identities: readonly ClaimsIdentity[];

  constructor(identity?: ClaimsIdentity | Iterable<ClaimsIdentity>) {
    if (identity === undefined) {
      this.identities = [];
    } else if (identity instanceof ClaimsIdentity) {
      this.identities = [identity];
    } else {
      this.identities = [...identity];
    }
  }

  /** Every claim across all identities. Port of `ClaimsPrincipal.Claims`. */
  get claims(): Claim[] {
    return this.identities.flatMap((identity) => [...identity.claims]);
  }

  /**
   * Returns matching claims across all identities - by claim type (case-insensitive) or by predicate.
   * Port of `ClaimsPrincipal.FindAll(type)` / `FindAll(Predicate<Claim>)`.
   */
  findAll(match: string | ClaimPredicate): Claim[] {
    const predicate = toPredicate(match);
    return this.claims.filter(predicate);
  }

  /**
   * Returns the first matching claim across all identities, or `undefined` - by claim type
   * (case-insensitive) or by predicate. Port of `ClaimsPrincipal.FindFirst`.
   */
  findFirst(match: string | ClaimPredicate): Claim | undefined {
    const predicate = toPredicate(match);
    return this.claims.find(predicate);
  }

  /**
   * Whether any claim matches - by predicate, or by exact (type, value) pair (type case-insensitive,
   * value case-sensitive). Port of `ClaimsPrincipal.HasClaim(Predicate<Claim>)` / `HasClaim(type, value)`.
   */
  hasClaim(match: ClaimPredicate): boolean;
  hasClaim(type: string, value: string): boolean;
  hasClaim(matchOrType: ClaimPredicate | string, value?: string): boolean {
    if (typeof matchOrType === 'string') {
      return this.identities.some((identity) => identity.hasClaim(matchOrType, value as string));
    }
    return this.claims.some(matchOrType);
  }

  /**
   * Whether the caller is in the given role: checks each identity's configured role claim
   * ({@link ClaimsIdentity.roleClaimType}). Port of `ClaimsPrincipal.IsInRole`.
   */
  isInRole(role: string): boolean {
    return this.identities.some((identity) => identity.hasClaim(identity.roleClaimType, role));
  }
}

function toPredicate(match: string | ClaimPredicate): ClaimPredicate {
  if (typeof match === 'string') {
    const type = match.toLowerCase();
    return (claim) => claim.type.toLowerCase() === type;
  }
  return match;
}
