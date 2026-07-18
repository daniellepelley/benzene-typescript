/**
 * Marker interface for the HTTP request/response context of a transport that speaks HTTP.
 * Port of Benzene.Http.IHttpContext.
 *
 * Transport-specific implementations (AWS Lambda API Gateway, ASP.NET Core, self-hosted servers,
 * ...) implement this and expose their own native request/response objects. As in C# it carries no
 * members — it exists only so HTTP-oriented components (`IHttpRequestAdapter<TContext>`,
 * `HttpStatusCodeResponseHandler<TContext>`) can constrain `TContext` to "some HTTP context".
 *
 * TypeScript's structural typing means an empty interface is satisfied by any object; the constraint
 * is documentary, exactly as the empty C# marker is.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IHttpContext {}
