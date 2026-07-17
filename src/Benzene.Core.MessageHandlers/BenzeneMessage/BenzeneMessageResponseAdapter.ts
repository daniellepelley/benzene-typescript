import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { BenzeneMessageContext, ensureResponseExists } from '@benzene/core-messages';
import { Constants } from '../Constants';

/**
 * The `BenzeneMessage` transport's `IBenzeneResponseAdapter<BenzeneMessageContext>`: reads and writes
 * headers, content type, status code, and body on the context's `benzeneMessageResponse`, creating
 * the response's headers on first write via `ensureResponseExists`.
 * Port of Benzene.Core.MessageHandlers.BenzeneMessage.BenzeneMessageResponseAdapter.
 *
 * Deviations: C# `DictionaryUtils.Set(headers, key, value)` is a trivial `headers[key] = value`,
 * inlined here. The byte overload of `setBody` (C#'s defaulted `SetBody(TContext, ReadOnlyMemory<byte>)`)
 * decodes UTF-8 and delegates to the string path.
 */
export class BenzeneMessageResponseAdapter implements IBenzeneResponseAdapter<BenzeneMessageContext> {
  setResponseHeader(context: BenzeneMessageContext, headerKey: string, headerValue: string): void {
    ensureResponseExists(context);
    context.benzeneMessageResponse.headers[headerKey] = headerValue;
  }

  setContentType(context: BenzeneMessageContext, contentType: string): void {
    this.setResponseHeader(context, Constants.contentTypeHeader, contentType);
  }

  setStatusCode(context: BenzeneMessageContext, statusCode: string): void {
    ensureResponseExists(context);
    context.benzeneMessageResponse.statusCode = statusCode;
  }

  setBody(context: BenzeneMessageContext, body: string): void;
  setBody(context: BenzeneMessageContext, body: Uint8Array): void;
  setBody(context: BenzeneMessageContext, body: string | Uint8Array): void {
    ensureResponseExists(context);
    context.benzeneMessageResponse.body =
      typeof body === 'string' ? body : new TextDecoder().decode(body);
  }

  getBody(context: BenzeneMessageContext): string {
    ensureResponseExists(context);
    return context.benzeneMessageResponse.body;
  }

  /** No-op for this transport: nothing further to flush once the response object is populated. */
  finalizeAsync(_context: BenzeneMessageContext): Promise<void> {
    return Promise.resolve();
  }
}
