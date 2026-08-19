import { BenzeneError } from '@benzenejs/abstractions';

/**
 * An [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document — the body of a failed
 * result (wire-contracts.md §1.3). Port of Benzene.Results.ProblemDetails.
 *
 * Deviation: C# declares nullable auto-properties with `[JsonIgnore(WhenWritingNull)]`; the port
 * types them optional (`| undefined`) so an unset member is simply omitted by `JSON.stringify`
 * rather than serialized as an explicit `null` the way System.Text.Json would.
 */
export class ProblemDetails {
  /**
   * A URI reference identifying the problem *type*. Framework-produced failures use the registry
   * URI for the status (`ProblemTypes`); applications should use their own absolute URI. Readers
   * treat it as an **opaque identifier** — compare by string equality, never dereference.
   */
  type: string | undefined;

  /** A short human summary of the *type*, fixed per type. Wording is never asserted by fixtures. */
  title: string | undefined;

  /**
   * The **HTTP** response status code — HTTP bindings only, and a `number`, not the Benzene status.
   * Must equal the actual HTTP response status when present, and must be **omitted** where no HTTP
   * response exists (an envelope over a queue), which is why it is filled in by the HTTP-aware
   * response mapper rather than by the transport-neutral `ProblemTypes.from`. Clients must not
   * classify success/failure from this member — classification is envelope-first (§1.2).
   */
  status: number | undefined;

  /**
   * Human-readable detail for this occurrence — the result's error messages joined with `", "`.
   * The compatibility member: every reader of the pre-RFC-9457 `ErrorPayload` shape used only this
   * one and keeps working unchanged.
   */
  detail: string | undefined;

  /** Optional, application-owned. The framework never fabricates a value. */
  instance: string | undefined;

  /**
   * **Required on framework-produced documents.** The Benzene status string (§3), mirroring the
   * envelope's `statusCode`. This is the transport-neutral discriminator — present on every
   * transport, whereas {@link status} only exists on HTTP.
   *
   * It replaced a `status: string` member that carried the Benzene status and collided with RFC
   * 9457's own `status` (defined as the integer HTTP code). The collision was resolved by rename,
   * not by dropping the RFC alignment. The `benzene` marker is there because this member namespace
   * is shared with RFC 9457 itself and with applications.
   */
  benzeneStatus: string | undefined;

  /**
   * The result's errors, when present — authoritative and ordered. Omitted from the wire when the
   * result carries none; a reader without this member treats {@link detail} as a single opaque
   * message.
   */
  errors: BenzeneError[] | undefined;
}
