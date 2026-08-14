/** Port of Benzene.Testing.HttpBuilder. */
import { IHttpBuilder } from '@benzenejs/abstractions';

/**
 * A fluent builder for an HTTP-shaped test request (method + path + typed body + headers), the input
 * the HTTP transport `as*` builders (`asApiGatewayRequest`, …) turn into a native cloud event. Port of
 * `Benzene.Testing.HttpBuilder<T>`; the C# static `HttpBuilder.Create` factory becomes the free
 * function {@link httpBuilder}.
 */
export class HttpBuilder<T> implements IHttpBuilder<T> {
  readonly headers: Record<string, string> = {};

  constructor(
    readonly method: string,
    readonly path: string,
    readonly message: T | undefined,
  ) {}

  /** Sets a header (last-wins, like a real header map). */
  withHeader(key: string, value: string): this {
    this.headers[key] = value;
    return this;
  }

  /** Merges headers in (additive, last-wins). */
  withHeaders(headers: Record<string, string>): this {
    for (const [key, value] of Object.entries(headers)) {
      this.headers[key] = value;
    }
    return this;
  }
}

/** Builds an HTTP request with no body. */
export function httpBuilder(method: string, path: string): HttpBuilder<object>;
/** Builds an HTTP request with a typed body. */
export function httpBuilder<T>(method: string, path: string, message: T): HttpBuilder<T>;
export function httpBuilder<T>(method: string, path: string, message?: T): HttpBuilder<T | object> {
  return new HttpBuilder<T | object>(method, path, message);
}
