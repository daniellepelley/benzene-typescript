import { IRequestMapper, IRequestMapperThunk } from '@benzene/abstractions-message-handlers';

/**
 * Binds a request mapper to a specific context.
 * Port of Benzene.Core.MessageHandlers.RequestMapperThunk&lt;TContext&gt;.
 */
export class RequestMapperThunk<TContext> implements IRequestMapperThunk {
  constructor(
    private readonly requestMapper: IRequestMapper<TContext>,
    private readonly context: TContext,
  ) {}

  getRequest<TRequest>(): TRequest | undefined {
    return this.requestMapper.getBody<TRequest>(this.context);
  }
}

/** Convenience thunk over an already-materialized request object. */
export class InlineRequestMapperThunk implements IRequestMapperThunk {
  constructor(private readonly request: unknown) {}

  getRequest<TRequest>(): TRequest | undefined {
    return this.request as TRequest | undefined;
  }
}
