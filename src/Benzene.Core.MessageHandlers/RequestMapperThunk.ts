import { ServiceIdentifier } from '@benzene/abstractions';
import { IRequestMapper, IRequestMapperThunk } from '@benzene/abstractions-message-handlers';

/**
 * Binds a request mapper to a specific context.
 * Port of Benzene.Core.MessageHandlers.RequestMapperThunk&lt;TContext&gt;.
 *
 * Carries the handler's request type (from the routed definition) so an erasure-sensitive mapper - the
 * version-casting `CastingRequestMapper` - can recover the target type `getRequest<TRequest>()` no longer
 * conveys at runtime. Optional, so a thunk built without it behaves exactly as before.
 */
export class RequestMapperThunk<TContext> implements IRequestMapperThunk {
  constructor(
    private readonly requestMapper: IRequestMapper<TContext>,
    private readonly context: TContext,
    private readonly requestType?: ServiceIdentifier<unknown>,
  ) {}

  getRequest<TRequest>(): TRequest | undefined {
    return this.requestMapper.getBody<TRequest>(this.context, this.requestType);
  }
}

/** Convenience thunk over an already-materialized request object. */
export class InlineRequestMapperThunk implements IRequestMapperThunk {
  constructor(private readonly request: unknown) {}

  getRequest<TRequest>(): TRequest | undefined {
    return this.request as TRequest | undefined;
  }
}
