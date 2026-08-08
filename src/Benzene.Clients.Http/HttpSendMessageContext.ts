/**
 * The context flowing through the outbound HTTP client (inner) pipeline: the request to send and the
 * response received.
 * Port of Benzene.Client.Http.HttpSendMessageContext.
 *
 * HttpClient -> fetch adaptation. .NET uses `HttpRequestMessage` / `HttpResponseMessage`. The port
 * maps `HttpResponseMessage` to the Node fetch `Response` (global in Node 22), and `HttpRequestMessage`
 * to a small transport-agnostic `HttpRequestMessage` shape (`{ url, method, headers, body }`) rather
 * than the fetch `Request`. The reason for not reusing fetch's `Request`: `HttpContextConverter`
 * always serializes the message to a JSON body regardless of verb (exactly as the C# converter does),
 * but the fetch `Request` constructor rejects a body on `GET`/`HEAD`; a plain object carries the body
 * for any verb, matching `HttpRequestMessage`, and makes the request trivially inspectable by an
 * injected/stubbed fetch in tests.
 */

/** The outbound HTTP request. Port of the shape of .NET `HttpRequestMessage` (verb + URI + headers + body). */
export interface HttpRequestMessage {
  /** Port of `HttpRequestMessage.RequestUri`. */
  url: string;
  /** Port of `HttpRequestMessage.Method`. */
  method: string;
  /** Port of `HttpRequestMessage.Headers`. C# `IDictionary<string,string>` -> `Record<string,string>`. */
  headers: Record<string, string>;
  /** Port of `HttpRequestMessage.Content` (the serialized JSON body string). */
  body: string;
}

export class HttpSendMessageContext {
  /** Port of C# `HttpRequestMessage Request { get; }`. */
  readonly request: HttpRequestMessage;

  /** Port of C# `HttpResponseMessage Response { get; set; }` — the fetch `Response`. */
  response!: Response;

  constructor(request: HttpRequestMessage) {
    this.request = request;
  }
}
