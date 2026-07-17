/**
 * Late-bound access to the deserialized request for the current context.
 * Port of Benzene.Abstractions.MessageHandlers.IRequestMapperThunk
 * (the C# generic `GetRequest<TRequest>()` becomes a cast-at-call-site, since
 * deserialization in TypeScript is shape-based).
 */
export interface IRequestMapperThunk {
  getRequest<TRequest>(): TRequest | undefined;
}
