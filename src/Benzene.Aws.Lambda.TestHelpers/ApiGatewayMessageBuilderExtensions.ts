/** Port of Benzene.Aws.Lambda.ApiGateway.TestHelpers.MessageBuilderExtensions. */
import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import { IHttpBuilder } from '@benzenejs/abstractions';
import { MessageSerializer } from '@benzenejs/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsApiGatewayRequestOptions {
  serializer?: MessageSerializer;
}

export interface AsApiGatewayCustomAuthorizerEventOptions {
  /** The API Gateway API ID stamped onto `requestContext.apiId` (the field the handler discriminates on). */
  apiId?: string;
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

/**
 * Builds a realistic API Gateway **HTTP API v2** (`APIGatewayProxyEventV2`, payload format 2.0) event from
 * an HTTP builder: the method/path live under `requestContext.http`, the body is the serialized message.
 * The v2 counterpart of {@link asApiGatewayRequest}.
 */
export function asApiGatewayV2Request<T>(
  source: IHttpBuilder<T>,
  options: AsApiGatewayRequestOptions = {},
): APIGatewayProxyEventV2 {
  const { serializer = jsonMessageSerializer } = options;
  const headers = { ...source.headers };
  if (!hasHeader(headers, 'content-type')) {
    headers['content-type'] = 'application/json';
  }

  return {
    version: '2.0',
    routeKey: `${source.method} ${source.path}`,
    rawPath: source.path,
    rawQueryString: '',
    headers,
    requestContext: {
      http: {
        method: source.method,
        path: source.path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'benzene-test',
      },
    } as APIGatewayProxyEventV2['requestContext'],
    body: source.message === undefined ? undefined : serializer.serialize(source.message),
    isBase64Encoded: false,
  };
}

/**
 * Builds an `APIGatewayRequestAuthorizerEvent` (a REQUEST-type custom authorizer request) from an HTTP
 * builder: method/path/headers come from the builder, `requestContext.apiId` from `options.apiId`
 * (default `"some-id"`). Port of C# `AsApiGatewayCustomAuthorizerEvent`. A custom authorizer request has
 * no body, so the message payload is not serialized onto the event.
 */
export function asApiGatewayCustomAuthorizerEvent<T>(
  source: IHttpBuilder<T>,
  options: AsApiGatewayCustomAuthorizerEventOptions = {},
): APIGatewayRequestAuthorizerEvent {
  const { apiId = 'some-id' } = options;

  return {
    type: 'REQUEST',
    methodArn: `arn:aws:execute-api:us-east-1:000000000000:${apiId}/test/${source.method}${source.path}`,
    resource: source.path,
    path: source.path,
    httpMethod: source.method,
    headers: { ...source.headers },
    multiValueHeaders: null,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    // requestContext is required by the type; only its apiId matters for routing.
    requestContext: { apiId } as APIGatewayRequestAuthorizerEvent['requestContext'],
  };
}

function hasHeader(headers: Record<string, string>, key: string): boolean {
  const lower = key.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === lower);
}
