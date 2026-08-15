/**
 * Port of Benzene.Clients.BenzeneMessageClientResponse.
 *
 * The response envelope returned by a Benzene service invoked through a message client. Deserializes
 * from the standard Benzene message envelope
 * (`{ "statusCode": ..., "isSuccessful": ..., "headers": { ... }, "body": "..." }`) written by the
 * serving side's `BenzeneMessageResponse` — see `docs/specification/wire-contracts.md`. `statusCode`
 * carries a Benzene result status (e.g. `"ok"`, `"not-found"`); numeric HTTP status codes from older
 * or HTTP-shaped services are also tolerated by the result-mapping helpers.
 *
 * C# `IDictionary<string, string>? headers = null` maps to an optional `Record<string, string>`
 * defaulting to `{}` (C# `null` -> `undefined`), and `bool? isSuccessful` to `boolean | undefined`.
 */
export class BenzeneMessageClientResponse {
  readonly statusCode: string;
  readonly headers: Record<string, string>;
  readonly body: string;

  /**
   * The sender's authoritative success/failure signal, when present (wire-contracts.md §1.2).
   * `undefined` means the sender didn't write it — an older service, or a language port that hasn't
   * picked up the `isSuccessful` field yet — in which case `asBenzeneResult` falls back to
   * classifying {@link statusCode} against the known status vocabulary.
   */
  readonly isSuccessful: boolean | undefined;

  constructor(
    statusCode: string,
    body: string,
    headers?: Record<string, string>,
    isSuccessful?: boolean,
  ) {
    this.statusCode = statusCode;
    this.body = body;
    this.headers = headers ?? {};
    this.isSuccessful = isSuccessful;
  }
}
