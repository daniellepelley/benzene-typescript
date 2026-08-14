/**
 * `@benzenejs/google-cloud-functions-http-testing` — the in-memory test harness for a Benzene service hosted
 * on Google Cloud Functions Gen2 HTTP. Port of Benzene.GoogleCloud.Functions.Http.TestHelpers, and the GCP
 * counterpart of `@benzenejs/aws-lambda-testing` / `@benzenejs/azure-function-testing`.
 *
 * Boot a real startup with `benzeneTestHost(MyStartUp)` (from `@benzenejs/testing`), override any dependency
 * with `.withServices(...)`, then finish with the single GCP-specific line `buildGoogleCloudFunctionHost(...)`
 * to get a {@link GoogleCloudFunctionBenzeneTestHost}. Turn a neutral `httpBuilder(method, path, body)` into
 * the native Functions Framework request with `asGoogleCloudHttpRequest`, push it in with
 * `host.sendHttpAsync(request)`, and assert on the returned {@link GoogleCloudFunctionResponse} — no live
 * Functions Framework server, no credentials.
 *
 * ASP.NET → EXPRESS DIVERGENCE (same root as the transport's): the C# helpers build an ASP.NET
 * `DefaultHttpContext` and dispatch through `IHttpFunction`. The Node Functions Framework is Express-shaped
 * (`(req, res)`), so the request/response test doubles are `@google-cloud/functions-framework`
 * `Request`/`Response`, split across the builder (request) and the host (captured response). See the README
 * "Porting conventions" ledger.
 */
export * from './GoogleCloudFunctionBenzeneTestHost';
export * from './BenzeneTestHostExtensions';
export * from './GoogleCloudHttpBuilderExtensions';
