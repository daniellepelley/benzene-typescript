/**
 * Marker interface for the HTTP request/response context of a transport that speaks HTTP.
 * Port of Benzene.Http.IHttpContext.
 *
 * Transport-specific implementations (AWS Lambda API Gateway, ASP.NET Core, self-hosted servers,
 * ...) implement this and expose their own native request/response objects. In C# it carries no
 * members — it exists only so HTTP-oriented components (`IHttpRequestAdapter<TContext>`,
 * `HttpStatusCodeResponseHandler<TContext>`) can constrain `TContext` to "some HTTP context".
 *
 * TypeScript's structural typing means an empty interface is satisfied by any object; the constraint
 * is documentary, exactly as the empty C# marker is. (It also stays deliberately empty rather than
 * declaring an optional `signal?: AbortSignal` member: a weak type — all-optional members — would
 * force every implementing context to share a property with it. The abort-signal convention is
 * therefore structural: a transport context that can observe its client disconnecting exposes a
 * `signal: AbortSignal` member, e.g. `@benzenejs/express`'s `ExpressContext`, and HTTP components
 * such as the BenzeneMessage envelope endpoint read it structurally — the TS-idiomatic port of
 * ASP.NET's `HttpContext.RequestAborted`.)
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IHttpContext {}
