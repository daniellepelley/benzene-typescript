import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * The write side of a transport-specific outgoing response, giving response handlers a common set
 * of operations for setting headers, content type, status, and body without depending on the
 * transport's native response type directly.
 * Port of Benzene.Abstractions.MessageHandlers.Response.IBenzeneResponseAdapter&lt;TContext&gt;.
 *
 * Deviation: the C# interface provides a default `SetBody(context, ReadOnlyMemory<byte>)` method
 * that decodes UTF-8 and delegates to the string overload. TypeScript interfaces cannot carry a
 * default implementation, so `setBody` is declared with both a string and a `Uint8Array` overload
 * and every implementer must supply the byte path itself (the trivial decode-and-delegate is a
 * one-liner via `TextDecoder`).
 */
export interface IBenzeneResponseAdapter<TContext> {
  /** Sets a header on the outgoing response. Port of C# `SetResponseHeader`. */
  setResponseHeader(context: TContext, headerKey: string, headerValue: string): void;

  /** Sets the content type of the outgoing response. Port of C# `SetContentType`. */
  setContentType(context: TContext, contentType: string): void;

  /** Sets the status code of the outgoing response. Port of C# `SetStatusCode`. */
  setStatusCode(context: TContext, statusCode: string): void;

  /** Sets the body of the outgoing response. Port of C# `SetBody(TContext, string)`. */
  setBody(context: TContext, body: string): void;

  /**
   * Sets the body of the outgoing response from raw UTF-8 bytes, for byte-oriented serialization.
   * Port of C# `SetBody(TContext, ReadOnlyMemory<byte>)` (which C# defaults; see the type remarks).
   */
  setBody(context: TContext, body: Uint8Array): void;

  /** Gets the body currently set on the outgoing response. Port of C# `GetBody`. */
  getBody(context: TContext): string;

  /** Completes the response after all response handlers have run. Port of C# `FinalizeAsync`. */
  finalizeAsync(context: TContext): Promise<void>;
}

export const IBenzeneResponseAdapter: ServiceToken<IBenzeneResponseAdapter<unknown>> =
  serviceToken<IBenzeneResponseAdapter<unknown>>('IBenzeneResponseAdapter');
