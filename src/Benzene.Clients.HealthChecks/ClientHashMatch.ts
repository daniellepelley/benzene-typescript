/** Port of Benzene.Clients.HealthChecks.ClientHashMatch. */

/**
 * The verdict of comparing a consumer's baked-in contract hash against the provider's live contract
 * hash. Written into the schema health check's data by `ClientHealthCheckProcessor`.
 *
 * C# auto-properties -> public mutable fields; `string?` -> `string | undefined`.
 */
export class ClientHashMatch {
  /** The provider's current contract hash. */
  serviceHashCode: string | undefined;

  /** The hash the consumer's client was generated against. */
  clientHashCode: string | undefined;

  /** Whether the two hashes match (i.e. no contract drift). */
  isMatch = false;
}
