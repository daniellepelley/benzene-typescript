import type { Request, Response } from '@google-cloud/functions-framework';
import { GoogleCloudFunctionRequestHandler } from '@benzenejs/google-cloud-functions-http';

/**
 * The response the Google Cloud Functions HTTP pipeline wrote — the captured status, headers, and body.
 *
 * IDIOM MAP: the C# `SendHttpAsync` returns the mutated `HttpContext` (request and a writable response
 * stream live on one object). The Functions Framework's Express-style model splits request and response
 * into two arguments — the pipeline writes to `res` via `res.statusCode = …` / `res.setHeader(…)` /
 * `res.end(…)` (see `ExpressResponseAdapter.finalizeAsync`) rather than into a stream on the request — so
 * the TS host captures exactly those writes and returns them as this shape (the "native response out"),
 * instead of handing back the request object.
 */
export interface GoogleCloudFunctionResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * In-memory Google Cloud Functions HTTP test host — the GCP counterpart of `AwsLambdaBenzeneTestHost` /
 * `AzureFunctionBenzeneTestHost`. Wraps the built request handler (`(req, res) => Promise<void>`) that a
 * real Functions Framework deployment dispatches through, and pushes native HTTP requests (built by
 * `asGoogleCloudHttpRequest` in this package) in through the front door via a single `sendHttpAsync`,
 * returning the response the pipeline wrote.
 *
 * IDIOM MAP: the C# `TestGoogleCloudFunction` is an `IHttpFunction` wrapper and `SendHttpAsync` is a
 * separate extension on it. Node's Functions Framework handler is a plain `(req, res)` closure with no
 * `IHttpFunction` interface, so — exactly as the AWS/Azure hosts fold `SendEventAsync` into a host method
 * — this folds the dispatch into `sendHttpAsync`, which also creates the capturing response the handler
 * writes to (the Functions Framework supplies `res` for a real invocation; a test has none, so the host
 * mints one). The name keeps the C#'s `SendHttpAsync` (HTTP is this host's only trigger), the GCP peer of
 * the AWS/Azure `sendEventAsync`.
 */
export class GoogleCloudFunctionBenzeneTestHost {
  constructor(private readonly handler: GoogleCloudFunctionRequestHandler) {}

  /**
   * Sends a native Functions Framework `Request` through the pipeline and returns the
   * {@link GoogleCloudFunctionResponse} the pipeline wrote (status, headers, body).
   * @param request The native HTTP request (typically built by `asGoogleCloudHttpRequest` in this package).
   */
  async sendHttpAsync(request: Request): Promise<GoogleCloudFunctionResponse> {
    const captured: GoogleCloudFunctionResponse = { statusCode: 0, headers: {}, body: '' };

    // A minimal Functions Framework-shaped response that captures exactly the members
    // `ExpressResponseAdapter.finalizeAsync` writes: the `statusCode` setter, `setHeader`, and `end`.
    const res = {
      get statusCode(): number {
        return captured.statusCode;
      },
      set statusCode(value: number) {
        captured.statusCode = value;
      },
      setHeader(key: string, value: string): void {
        captured.headers[key] = value;
      },
      end(chunk?: string): void {
        captured.body = chunk ?? '';
      },
    } as unknown as Response;

    await this.handler(request, res);
    return captured;
  }
}
