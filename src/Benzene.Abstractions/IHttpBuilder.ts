/**
 * Describes an HTTP request being built (headers, method, path and body).
 * Port of Benzene.Abstractions.IHttpBuilder&lt;T&gt;.
 */
export interface IHttpBuilder<T> {
  readonly headers: Record<string, string>;

  readonly method: string;

  readonly path: string;

  readonly message: T | undefined;
}
