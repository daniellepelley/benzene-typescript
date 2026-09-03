import { describe, expect, it } from 'vitest';
import { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import { HttpTopicRoute, IHttpHeaderMappings, IRouteFinder } from '@benzenejs/http';
import {
  ApiGatewayContext,
  ApiGatewayHttpRequestAdapter,
  ApiGatewayRequestEnricher,
  ApiGatewayV2Context,
  ApiGatewayV2RequestEnricher,
} from '@benzenejs/aws-lambda-api-gateway';

/**
 * Port of test/Benzene.Core.Test/Aws/ApiGateway/ApiGatewayHeaderCasingAndQueryStringTest.cs
 * (benzene-dotnet, R7-10 #89/#90):
 *
 * #89 — the v1 `ApiGatewayHttpRequestAdapter` never normalized header casing; every consumer
 * (auth/CORS middleware) reads headers by lowercase literal key, so a raw `map()` result's
 * `authorization` lookup must succeed WITHOUT `asLowerCase()` being called first. (JS objects are
 * ordinal, so pre-lower-cased keys stand in for .NET #105's `OrdinalIgnoreCase` dictionary; the
 * .NET any-casing-lookup test therefore has no direct port.)
 *
 * #90 — a repeated query-string key resolves FIRST-value-wins identically across the v1 enricher
 * (multi-value map's first value, single-value fallback), the v2 enricher (first comma-separated
 * segment), and the Express adapter.
 */

function v1Event(fields: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return { path: '/example', httpMethod: 'GET', ...fields } as APIGatewayProxyEvent;
}

function v2Event(queryStringParameters: Record<string, string | undefined>): APIGatewayProxyEventV2 {
  return {
    rawPath: '/example',
    queryStringParameters,
    requestContext: { http: { method: 'GET', path: '/example' } },
  } as unknown as APIGatewayProxyEventV2;
}

const routeFinderMatchingAnything: IRouteFinder = {
  find: () => new HttpTopicRoute('example:topic', {}),
};

const noHeaderMappings: IHttpHeaderMappings = { getMappings: () => ({}) };

describe('ApiGatewayHttpRequestAdapter header casing (#89)', () => {
  it('lower-cases mixed-case headers without needing asLowerCase', () => {
    const context = new ApiGatewayContext(
      v1Event({
        headers: { Authorization: 'Bearer abc123', Origin: 'https://example.com' },
      }),
    );

    const request = new ApiGatewayHttpRequestAdapter().map(context);

    expect(request.headers['authorization']).toBe('Bearer abc123');
    expect(request.headers['origin']).toBe('https://example.com');
  });

  it('returns an empty dictionary for null headers, without throwing', () => {
    const context = new ApiGatewayContext(
      v1Event({ headers: null as unknown as APIGatewayProxyEvent['headers'] }),
    );

    const request = new ApiGatewayHttpRequestAdapter().map(context);

    expect(request.headers).toEqual({});
  });

  it('#105: case-colliding headers resolve first-wins rather than clobbering', () => {
    const context = new ApiGatewayContext(
      v1Event({
        headers: { 'Content-Type': 'application/json', 'content-type': 'text/plain' },
      }),
    );

    const request = new ApiGatewayHttpRequestAdapter().map(context);

    expect(request.headers['content-type']).toBe('application/json');
  });

  it('#105: a bare payload with no method/path defaults to empty strings, not undefined', () => {
    const context = new ApiGatewayContext({
      path: null,
      httpMethod: null,
      headers: null,
    } as unknown as APIGatewayProxyEvent);

    const request = new ApiGatewayHttpRequestAdapter().map(context);

    expect(request.method).toBe('');
    expect(request.path).toBe('');
  });
});

describe('ApiGateway query-string first-wins (#90)', () => {
  it('v1: a repeated query key with the multi-value map available takes the FIRST value', () => {
    // Real API Gateway REST API (v1) proxy events populate BOTH maps: queryStringParameters
    // (single value — AWS keeps the LAST occurrence) and multiValueQueryStringParameters (every
    // value, in order).
    const request = v1Event({
      queryStringParameters: { status: 'inactive' },
      multiValueQueryStringParameters: { status: ['active', 'inactive'] },
    });

    const dictionary = new ApiGatewayRequestEnricher(
      routeFinderMatchingAnything,
      noHeaderMappings,
    ).enrich(null, new ApiGatewayContext(request));

    expect(dictionary['status']).toBe('active');
  });

  it('v1: no multi-value map falls back to the single-value map', () => {
    const request = v1Event({ queryStringParameters: { status: 'active' } });

    const dictionary = new ApiGatewayRequestEnricher(
      routeFinderMatchingAnything,
      noHeaderMappings,
    ).enrich(null, new ApiGatewayContext(request));

    expect(dictionary['status']).toBe('active');
  });

  it('v2: a comma-joined repeated key takes the FIRST segment', () => {
    // API Gateway HTTP API (v2) joins repeated values into one comma-separated string before
    // Lambda ever sees the event — there is no multi-value map.
    const dictionary = new ApiGatewayV2RequestEnricher(
      routeFinderMatchingAnything,
      noHeaderMappings,
    ).enrich(null, new ApiGatewayV2Context(v2Event({ status: 'active,inactive' })));

    expect(dictionary['status']).toBe('active');
  });

  it('v1 and v2 agree on the first-wins policy for the same logical request', () => {
    // Documents the cross-transport parity #90 asks for: given the same logical repeated query
    // key, both payload formats resolve to the SAME (first) value for the identical route.
    const v1Dictionary = new ApiGatewayRequestEnricher(
      routeFinderMatchingAnything,
      noHeaderMappings,
    ).enrich(
      null,
      new ApiGatewayContext(
        v1Event({ multiValueQueryStringParameters: { status: ['active', 'inactive'] } }),
      ),
    );

    const v2Dictionary = new ApiGatewayV2RequestEnricher(
      routeFinderMatchingAnything,
      noHeaderMappings,
    ).enrich(null, new ApiGatewayV2Context(v2Event({ status: 'active,inactive' })));

    expect(v1Dictionary['status']).toBe('active');
    expect(v2Dictionary['status']).toBe('active');
  });
});
