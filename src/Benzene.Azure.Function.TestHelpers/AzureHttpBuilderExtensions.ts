/** Port of Benzene.Azure.Function.AspNet.TestHelpers.HttpBuilderExtensions, retargeted to @azure/functions. */
import { HttpRequest } from '@azure/functions';
import { IHttpBuilder } from '@benzenejs/abstractions';
import { MessageSerializer } from '@benzenejs/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsAzureHttpRequestOptions {
  serializer?: MessageSerializer;
}

/**
 * Builds a realistic `@azure/functions` `HttpRequest` from an HTTP builder: method/path/headers come from
 * the builder and the body is the serialized message (absent when the builder has none). A
 * `content-type: application/json` header is defaulted when the builder set none so the JSON body parses.
 */
export function asAzureHttpRequest<T>(
  source: IHttpBuilder<T>,
  options: AsAzureHttpRequestOptions = {},
): HttpRequest {
  const { serializer = jsonMessageSerializer } = options;
  const headers = { ...source.headers };
  if (!hasHeader(headers, 'content-type')) {
    headers['content-type'] = 'application/json';
  }

  return new HttpRequest({
    method: source.method,
    url: `http://localhost${source.path}`,
    headers,
    body: source.message === undefined ? undefined : { string: serializer.serialize(source.message) },
  });
}

function hasHeader(headers: Record<string, string>, key: string): boolean {
  const lower = key.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === lower);
}
