/**
 * RFC 7807-style problem-details payload used as the base for serialized error responses.
 * Port of Benzene.Results.ProblemDetails.
 *
 * Deviation: C# declares five always-present `string` auto-properties (null until set); the port
 * types them as optional (`string | undefined`) so an unset field is simply omitted by
 * `JSON.stringify`, rather than serialized as an explicit `null` the way System.Text.Json would.
 */
export class ProblemDetails {
  type: string | undefined;
  status: string | undefined;
  title: string | undefined;
  detail: string | undefined;
  instance: string | undefined;
}
