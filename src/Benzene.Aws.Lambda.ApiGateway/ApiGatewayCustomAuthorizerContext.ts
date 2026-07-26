import { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayCustomAuthorizer.ApiGatewayCustomAuthorizerContext.
 *
 * The middleware pipeline context for an API Gateway custom (Lambda) authorizer request: it wraps the
 * raw AWS authorizer request and carries the authorizer response (an IAM policy document) the pipeline
 * produces.
 *
 * TYPE MAPPING: C#'s single `APIGatewayCustomAuthorizerRequest` covers both TOKEN and REQUEST
 * authorizers; the port keys off the REQUEST-authorizer shape (`APIGatewayRequestAuthorizerEvent`),
 * because that is the one carrying `requestContext.apiId` — the field the handler discriminates on
 * (a TOKEN authorizer has no `requestContext`, so it never reaches this pipeline, exactly as in .NET,
 * whose `CanHandle` also requires a non-empty API ID). `APIGatewayCustomAuthorizerResponse` maps to
 * `APIGatewayAuthorizerResult` (principalId + policyDocument + optional context/usageIdentifierKey).
 */
export class ApiGatewayCustomAuthorizerContext {
  /** The raw API Gateway custom authorizer request. */
  readonly apiGatewayCustomAuthorizerRequest: APIGatewayRequestAuthorizerEvent;

  /**
   * The custom authorizer response (typically an IAM policy document) to return. Populated by a
   * `useCustomAuthorizer` step; `undefined` until one runs.
   */
  apiGatewayCustomAuthorizerResponse: APIGatewayAuthorizerResult | undefined;

  constructor(apiGatewayCustomAuthorizerRequest: APIGatewayRequestAuthorizerEvent) {
    this.apiGatewayCustomAuthorizerRequest = apiGatewayCustomAuthorizerRequest;
  }
}
