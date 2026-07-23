import { Claim } from './Claim';
import { ClaimTypes } from './ClaimTypes';

/**
 * Minimal port of `System.Security.Claims.ClaimsIdentity` (BCL) - a single authenticated identity
 * and its claims. See {@link Claim} for why this BCL slice is ported into `@benzene/auth-core`.
 *
 * Comparison semantics mirror the BCL: claim-type matching is case-insensitive (ordinal), claim-value
 * matching is case-sensitive (ordinal), exactly as `ClaimsIdentity.HasClaim`/`FindAll` behave.
 */
export class ClaimsIdentity {
  /** The identity's claims. */
  readonly claims: readonly Claim[];

  /**
   * The authentication type (e.g. `"Basic"`, `"Bearer"`), or `undefined` for an anonymous identity.
   * Port of `ClaimsIdentity.AuthenticationType`; drives {@link isAuthenticated}.
   */
  readonly authenticationType: string | undefined;

  /** The claim type read by {@link name}. Port of `ClaimsIdentity.NameClaimType` (defaults to {@link ClaimTypes.name}). */
  readonly nameClaimType: string;

  /** The claim type read by `ClaimsPrincipal.isInRole`. Port of `ClaimsIdentity.RoleClaimType` (defaults to {@link ClaimTypes.role}). */
  readonly roleClaimType: string;

  constructor(
    claims?: Iterable<Claim>,
    authenticationType?: string,
    nameClaimType: string = ClaimTypes.name,
    roleClaimType: string = ClaimTypes.role,
  ) {
    this.claims = claims ? [...claims] : [];
    this.authenticationType = authenticationType;
    this.nameClaimType = nameClaimType;
    this.roleClaimType = roleClaimType;
  }

  /** Whether the identity is authenticated. Port of `ClaimsIdentity.IsAuthenticated` (true when an authentication type is set). */
  get isAuthenticated(): boolean {
    return this.authenticationType !== undefined && this.authenticationType !== '';
  }

  /** The value of the first {@link nameClaimType} claim, or `undefined`. Port of `ClaimsIdentity.Name`. */
  get name(): string | undefined {
    return this.findFirst(this.nameClaimType)?.value;
  }

  /** Returns every claim of the given type (case-insensitive type match). Port of `ClaimsIdentity.FindAll(type)`. */
  findAll(type: string): Claim[] {
    return this.claims.filter((claim) => typeEquals(claim.type, type));
  }

  /** Returns the first claim of the given type, or `undefined`. Port of `ClaimsIdentity.FindFirst(type)`. */
  findFirst(type: string): Claim | undefined {
    return this.claims.find((claim) => typeEquals(claim.type, type));
  }

  /**
   * Whether the identity has a claim with the given type and value (type case-insensitive, value
   * case-sensitive). Port of `ClaimsIdentity.HasClaim(type, value)`.
   */
  hasClaim(type: string, value: string): boolean {
    return this.claims.some((claim) => typeEquals(claim.type, type) && claim.value === value);
  }
}

/** Ordinal case-insensitive claim-type comparison, matching the BCL's `StringComparer.OrdinalIgnoreCase`. */
function typeEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
