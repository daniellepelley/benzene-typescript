import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { ExpressContext } from './ExpressContext';

/**
 * Returns the raw request body string (read up front by the middleware and stored on the context), so the
 * request mapper deserializes it with the negotiated serializer - exactly as the other HTTP transports do.
 * Express analog of `Benzene.AspNet.Core.AspNetMessageBodyGetter`.
 */
export class ExpressMessageBodyGetter implements IMessageBodyGetter<ExpressContext> {
  getBody(context: ExpressContext): string | undefined {
    return context.rawBody === '' ? undefined : context.rawBody;
  }
}
