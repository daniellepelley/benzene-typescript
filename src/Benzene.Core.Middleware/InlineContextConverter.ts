import { IContextConverter } from '@benzene/abstractions-middleware';

/**
 * Adapts a pair of functions into an IContextConverter.
 * Port of Benzene.Core.Middleware.InlineContextConverter&lt;TContextIn, TContextOut&gt;.
 */
export class InlineContextConverter<TContextIn, TContextOut>
  implements IContextConverter<TContextIn, TContextOut>
{
  constructor(
    private readonly createContextFunc: (contextIn: TContextIn) => TContextOut,
    private readonly mapContext: (contextIn: TContextIn, contextOut: TContextOut) => void,
  ) {}

  createRequestAsync(contextIn: TContextIn): Promise<TContextOut> {
    return Promise.resolve(this.createContextFunc(contextIn));
  }

  mapResponseAsync(contextIn: TContextIn, contextOut: TContextOut): Promise<void> {
    this.mapContext(contextIn, contextOut);
    return Promise.resolve();
  }
}
