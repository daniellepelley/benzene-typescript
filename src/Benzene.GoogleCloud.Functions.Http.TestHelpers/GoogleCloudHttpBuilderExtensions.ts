/**
 * Port of Benzene.GoogleCloud.Functions.Http.TestHelpers.HttpContextBuilder, retargeted to
 * `@google-cloud/functions-framework`.
 *
 * IDIOM MAP: the C# builder produces an ASP.NET `DefaultHttpContext` test double (method/path/headers plus
 * a body stream, and a writable response stream). The Node Functions Framework does not use ASP.NET's
 * `HttpContext`; its handler is `(req, res)` over Express-style `Request`/`Response`. So this splits the C#
 * builder in two, matching the Azure sibling: this file builds the native `Request` (the input), and the
 * `GoogleCloudFunctionBenzeneTestHost` mints and captures the `Response` (the output) at dispatch. Shaped
 * exactly like the Azure sibling's `asAzureHttpRequest`, so the two read identically bar the builder name.
 */
import { IHttpBuilder } from '@benzenejs/abstractions';
import { MessageSerializer } from '@benzenejs/testing';
import type { Request } from '@google-cloud/functions-framework';
import { jsonMessageSerializer } from './defaults';

export interface AsGoogleCloudHttpRequestOptions {
  serializer?: MessageSerializer;
}

/**
 * Builds a realistic Functions Framework `Request` from an HTTP builder: method/path/headers come from the
 * builder and the body is the serialized message (empty when the builder has none). A
 * `content-type: application/json` header is defaulted when the builder set none so the JSON body parses.
 *
 * The transport reads the request body from `req.rawBody` (the raw byte buffer the Functions Framework
 * populates), so the serialized body is provided both as `rawBody` (a `Buffer`) and as `body`, and `path`
 * is set alongside `url` — exactly the members the host's `ExpressContext` bridge and `readRawBody` read.
 */
export function asGoogleCloudHttpRequest<T>(
  source: IHttpBuilder<T>,
  options: AsGoogleCloudHttpRequestOptions = {},
): Request {
  const { serializer = jsonMessageSerializer } = options;
  const headers = { ...source.headers };
  if (!hasHeader(headers, 'content-type')) {
    headers['content-type'] = 'application/json';
  }

  const body = source.message === undefined ? '' : serializer.serialize(source.message);

  return {
    method: source.method,
    url: source.path,
    path: source.path.split('?')[0],
    headers,
    rawBody: Buffer.from(body, 'utf8'),
    body,
  } as unknown as Request;
}

function hasHeader(headers: Record<string, string>, key: string): boolean {
  const lower = key.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === lower);
}
