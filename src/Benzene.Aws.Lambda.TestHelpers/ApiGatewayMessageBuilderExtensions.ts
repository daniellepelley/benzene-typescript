/** Port of Benzene.Aws.Lambda.ApiGateway.TestHelpers.MessageBuilderExtensions. */
import { APIGatewayProxyEvent } from 'aws-lambda';
import { IHttpBuilder } from '@benzene/abstractions';
import { MessageSerializer } from '@benzene/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsApiGatewayRequestOptions {
  serializer?: MessageSerializer;
}

/**
 * Builds a realistic `APIGatewayProxyEvent` from an HTTP builder: method/path/headers come from the
 * builder, the body is the serialized message (or `null` when absent). A `content-type: application/json`
 * header is defaulted when the builder set none, so the JSON body parses - a small test-DX convenience
 * over the C# original, which leaves headers exactly as supplied.
 */
export function asApiGatewayRequest<T>(
  source: IHttpBuilder<T>,
  options: AsApiGatewayRequestOptions = {},
): APIGatewayProxyEvent {
  const { serializer = jsonMessageSerializer } = options;
  const headers = { ...source.headers };
  if (!hasHeader(headers, 'content-type')) {
    headers['content-type'] = 'application/json';
  }

  return {
    httpMethod: source.method,
    path: source.path,
    resource: source.path,
    body: source.message === undefined ? null : serializer.serialize(source.message),
    headers,
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    isBase64Encoded: false,
    // requestContext is required by the type; only its presence matters for routing.
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
  };
}

function hasHeader(headers: Record<string, string>, key: string): boolean {
  const lower = key.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === lower);
}
