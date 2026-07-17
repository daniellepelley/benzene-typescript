import { BenzeneMessageContext } from './BenzeneMessageContext';
import { BenzeneMessageResponse } from './BenzeneMessageResponse';

/**
 * Port of Benzene.Core.Messages.BenzeneMessage.Extensions.
 *
 * C# `this`-extension method becomes a free function (non-fluent extension → free function, per the
 * porting conventions). Ensures a `BenzeneMessageContext` has a response object with an initialized
 * headers dictionary before anything writes to it.
 */
export function ensureResponseExists(context: BenzeneMessageContext): void {
  context.benzeneMessageResponse ??= new BenzeneMessageResponse();
  context.benzeneMessageResponse.headers ??= {};
}
