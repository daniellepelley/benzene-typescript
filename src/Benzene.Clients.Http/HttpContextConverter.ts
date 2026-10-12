import { ISerializer } from '@benzenejs/abstractions';
import { IBenzeneClientContext } from '@benzenejs/abstractions-messages';
import { IContextConverter } from '@benzenejs/abstractions-middleware';
import { convertStatusCode, failedResultFromProblem, readProblemDocument } from '@benzenejs/clients';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { HttpRequestMessage, HttpSendMessageContext } from './HttpSendMessageContext';

/**
 * Converts an `IBenzeneClientContext<TRequest, TResponse>` (the outer, message-shaped client context)
 * to/from an `HttpSendMessageContext` (the inner, HTTP-shaped context): on the way out it serializes
 * the request message to a JSON body and builds the request with the configured verb/path/headers; on
 * the way back it maps the HTTP status code to a `BenzeneResult` via `convertStatusCode`: a success
 * carries the body deserialized to `TResponse`; a failure whose body is `application/problem+json`
 * carries the document's status (`benzeneStatus`), its errors (field and code intact) and the document
 * itself.
 * Port of Benzene.Client.Http.HttpContextConverter&lt;TRequest, TResponse&gt;.
 *
 * The .NET `response.StatusCode.Convert(response)` (`Benzene.Results.BenzeneResultExtensions.Convert`)
 * maps to `@benzenejs/clients`' `convertStatusCode(status, payload)` (success carries the payload; the
 * code->status table is the inverse of `@benzenejs/http`'s `DefaultHttpStatusCodeMapper`).
 *
 * Deviation: the two C# constructor overloads (`(verb, path)` and `(ISerializer)`) collapse into one
 * constructor whose serializer argument defaults to a `JsonSerializer`; the extensions only ever use
 * the `(verb, path)` form. `JsonSerializer` is reused from `@benzenejs/core-message-handlers` — it is
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
    const httpStatus = contextOut.response.status;

    if (contextOut.response.ok) {
      const response = this.serializer.deserialize<TResponse>(body) as TResponse;
      contextIn.response = convertStatusCode<TResponse>(httpStatus, response);
      return;
    }

    // A failure. When the body is an `application/problem+json` document, the result's status is its
    // `benzeneStatus` (wire-contracts §4.1, spec 1.1 - so an application-defined status survives the hop),
    // its `errors` are rebuilt with `field` and `code` intact, and the document is attached (core-concepts
    // §12 "Error fidelity"). Otherwise - or for a document without `benzeneStatus` - the status comes from
    // the HTTP code through the reverse table. Any other
    // failure body (an HTML error page, an empty body) is not parsed: deserializing it as TResponse would
    // throw and hide the real status.
    const mapped = convertStatusCode<TResponse>(httpStatus, undefined as TResponse);
    contextIn.response = isProblemJson(contextOut.response.headers.get('content-type'))
      ? failedResultFromProblem<TResponse>(mapped.status, readProblemDocument(body, this.serializer))
      : mapped;
  }
}

/** Whether a `content-type` names `application/problem+json` (RFC 9457), parameters and case ignored. */
function isProblemJson(contentType: string | null): boolean {
  return contentType !== null && contentType.split(';')[0]!.trim().toLowerCase() === 'application/problem+json';
}
