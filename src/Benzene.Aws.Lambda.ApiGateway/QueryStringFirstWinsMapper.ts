/** Port of Benzene.Aws.Lambda.ApiGateway.QueryStringFirstWinsMapper (internal in .NET). */
import { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Picks the FIRST value per key for a repeated query-string parameter, matching
 * `AspNetRequestEnricher`'s first-wins policy — so `?status=active&status=inactive` binds
 * identically across transports for the identical route/handler, rather than diverging between
 * "first wins" (ASP.NET Core / the Express adapter) and "last wins" (the raw API Gateway payload).
 * .NET R7-10 #90.
 */
export const QueryStringFirstWinsMapper = {
  /**
   * API Gateway REST API (v1, payload format 1.0) proxy requests carry the query string two ways:
   * `queryStringParameters` (single value per key — AWS keeps only the LAST occurrence of a
   * repeated key) and `multiValueQueryStringParameters` (every value, in the order they appeared on
   * the wire). Prefer the multi-value map and take the FIRST value per key; fall back to the
   * single-value map when the multi-value one is absent (e.g. a hand-built payload — tests
   * included — that only sets the single-value field, or a genuinely query-less request).
   */
  forV1(request: APIGatewayProxyEvent): Record<string, string | undefined> | undefined {
    const multiValue = request.multiValueQueryStringParameters;
    if (multiValue == null) {
      return request.queryStringParameters ?? undefined;
    }

    const firstWins: Record<string, string | undefined> = {};
    for (const [key, values] of Object.entries(multiValue)) {
      firstWins[key] = values?.[0];
    }
    return firstWins;
  },

  /**
   * API Gateway HTTP API (v2, payload format 2.0) requests carry no multi-value map — AWS itself
   * joins repeated values for the same key into one comma-separated string in
   * `queryStringParameters` before Lambda ever sees the event (AWS's documented v2 encoding). Take
   * the FIRST comma-separated segment per key.
   */
  forV2(
    queryStringParameters: Record<string, string | undefined> | null | undefined,
  ): Record<string, string | undefined> | undefined {
    if (queryStringParameters == null) {
      return undefined;
    }

    const firstWins: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(queryStringParameters)) {
      firstWins[key] = value?.split(',')[0];
    }
    return firstWins;
  },
};
