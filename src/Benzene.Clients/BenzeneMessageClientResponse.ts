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
   * The sender's success/failure signal (wire-contracts.md §1.2). `undefined` means the envelope is
   * malformed — `asBenzeneResult` then treats it as unsuccessful; {@link statusCode} is never
   * re-classified from its text.
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
