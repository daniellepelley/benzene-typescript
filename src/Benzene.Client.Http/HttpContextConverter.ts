import { ISerializer } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { IContextConverter } from '@benzene/abstractions-middleware';
import { convertStatusCode } from '@benzene/clients';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { HttpRequestMessage, HttpSendMessageContext } from './HttpSendMessageContext';

/**
 * Converts an `IBenzeneClientContext<TRequest, TResponse>` (the outer, message-shaped client context)
 * to/from an `HttpSendMessageContext` (the inner, HTTP-shaped context): on the way out it serializes
 * the request message to a JSON body and builds the request with the configured verb/path/headers; on
 * the way back it reads the response body, deserializes it to `TResponse`, and maps the HTTP status
 * code to a `BenzeneResult` via `convertStatusCode`.
 * Port of Benzene.Client.Http.HttpContextConverter&lt;TRequest, TResponse&gt;.
 *
 * The .NET `response.StatusCode.Convert(response)` (`Benzene.Results.BenzeneResultExtensions.Convert`)
 * maps to `@benzene/clients`' `convertStatusCode(status, payload)` (success carries the payload; the
 * code->status table is the inverse of `@benzene/http`'s `DefaultHttpStatusCodeMapper`).
 *
 * Deviation: the two C# constructor overloads (`(verb, path)` and `(ISerializer)`) collapse into one
 * constructor whose serializer argument defaults to a `JsonSerializer`; the extensions only ever use
 * the `(verb, path)` form. `JsonSerializer` is reused from `@benzene/core-message-handlers` — it is
 * behaviourally identical to `Benzene.Clients/JsonSerializer.cs` (camelCase, case-insensitive) once
 * the port's camelCase property names are accounted for.
 */
export class HttpContextConverter<TRequest, TResponse>
  implements IContextConverter<IBenzeneClientContext<TRequest, TResponse>, HttpSendMessageContext>
{
  private readonly serializer: ISerializer;
  private readonly verb: string;
  private readonly path: string;

  constructor(verb: string, path: string, serializer: ISerializer = new JsonSerializer()) {
    this.verb = verb;
    this.path = path;
    this.serializer = serializer;
  }

  createRequestAsync(
    contextIn: IBenzeneClientContext<TRequest, TResponse>,
  ): Promise<HttpSendMessageContext> {
    const request: HttpRequestMessage = {
      url: this.path,
      method: this.verb,
      headers: {
        // C# `new StringContent(..., Encoding.UTF8, "application/json")` sets the content type;
        // caller headers are then added (C# `Headers.TryAddWithoutValidation`).
        'content-type': 'application/json',
        ...contextIn.request.headers,
      },
      body: this.serializer.serialize(contextIn.request.message),
    };

    return Promise.resolve(new HttpSendMessageContext(request));
  }

  async mapResponseAsync(
    contextIn: IBenzeneClientContext<TRequest, TResponse>,
    contextOut: HttpSendMessageContext,
  ): Promise<void> {
    // A fetch `Response` body is single-read; read it once as text (C# `ReadAsStringAsync`).
    const body = await contextOut.response.text();
    const response = this.serializer.deserialize<TResponse>(body) as TResponse;
    contextIn.response = convertStatusCode<TResponse>(contextOut.response.status, response);
  }
}
