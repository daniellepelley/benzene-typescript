/** Port of Benzene.Mesh.Dispatch.HttpMeshServiceDispatcher. */
import { MeshServiceRegistryEntry, MeshServiceSource } from '@benzenejs/mesh-contracts';
import { MeshDispatchEnvelope, MeshDispatchResult } from './MeshDispatchEnvelope';
import { MeshDispatchGuardOptions } from './MeshDispatchGuardOptions';
import { IMeshServiceDispatcher } from './IMeshServiceDispatcher';

/** The `SourceOptions` key overriding the invoke URL. */
export const InvokeUrlOption = 'invokeUrl';
const DefaultInvokePath = '/benzene-message';

/** A `fetch`-like function - the port of C# `HttpClient.PostAsync` (`HttpClient` -> injectable `fetch`). */
export type DispatchFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Dispatches to an HTTP-reachable service by POSTing the Benzene message envelope (`{ topic, headers, body }`)
 * to its wire-envelope endpoint. The endpoint URL comes from the entry's `sourceOptions["invokeUrl"]` when
 * present, otherwise derived from the entry's `specUrl` origin as `<origin>/benzene-message`.
 *
 * `HttpClient` -> an injectable `fetch` (default global `fetch`), the same adaptation as
 * `@benzenejs/health-checks-http`.
 */
export class HttpMeshServiceDispatcher implements IMeshServiceDispatcher {
  /**
   * Default {@link maxResponseBytes} - deliberately matches
   * `MeshDispatchGuardOptions.DefaultMaxRequestBytes`, the request-side cap this mirrors: the same
   * bound applies symmetrically to what a target is allowed to send back.
   */
  static readonly DefaultMaxResponseBytes = MeshDispatchGuardOptions.DefaultMaxRequestBytes;

  /** Appended to a response body that was cut off at {@link maxResponseBytes}. */
  static readonly TruncatedMarker = '…[benzene.mesh.dispatch: response truncated]';

  /**
   * The largest target response body accepted, in bytes. Enforced while reading the response stream
   * (.NET #187's noted gap): the request side has always bounded what a caller can send
   * (`MeshDispatchGuardOptions.maxRequestBytes`), but nothing bounded what a dispatched-to service
   * could send back - a compromised or misbehaving target could otherwise have this buffer an
   * unbounded response into memory. A response that exceeds the cap is truncated with
   * {@link HttpMeshServiceDispatcher.TruncatedMarker} rather than the dispatch throwing, because the
   * target DID respond and that response is still the record of what happened - the same "leaves a
   * record" principle the audit trail is built on.
   */
  readonly maxResponseBytes: number;

  constructor(
    private readonly fetchFn: DispatchFetch = fetch,
    maxResponseBytes: number = HttpMeshServiceDispatcher.DefaultMaxResponseBytes,
  ) {
    this.maxResponseBytes = maxResponseBytes;
  }

  get key(): string {
    return MeshServiceSource.http;
  }

  async dispatchAsync(
    entry: MeshServiceRegistryEntry,
    envelope: MeshDispatchEnvelope,
    cancellationToken?: AbortSignal,
  ): Promise<MeshDispatchResult> {
    const url = resolveInvokeUrl(entry);
    const payload = JSON.stringify({
      topic: envelope.topic,
      headers: envelope.headers,
      body: envelope.body,
    });

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      signal: cancellationToken,
    });
    const responseBody = await readCapped(response, this.maxResponseBytes);

    // Pass back exactly what the service returned. A non-2xx HTTP status still carries a body.
    return new MeshDispatchResult(String(response.status), responseBody);
  }
}

/**
 * Reads the response as UTF-8 text, stopping once `maxBytes` raw bytes have been read and appending
 * {@link HttpMeshServiceDispatcher.TruncatedMarker} when that happened - see
 * {@link HttpMeshServiceDispatcher.maxResponseBytes}. Reads the body stream chunk-by-chunk so an
 * unbounded response never fully buffers (a bodiless response reads as empty).
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;

  if (response.body !== null) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const remaining = maxBytes - length;
        if (remaining <= 0) {
          truncated = true;
          break;
        }

        const toKeep = value.length <= remaining ? value : value.subarray(0, remaining);
        chunks.push(toKeep);
        length += toKeep.length;
        if (toKeep.length < value.length) {
          truncated = true;
          break;
        }
      }
    } finally {
      if (truncated) {
        // Stop the target from streaming further; errors from an already-closed stream are moot.
        await reader.cancel().catch(() => undefined);
      }
    }
  }

  let bytes = concat(chunks, length);
  if (truncated) {
    // .NET #246: back the truncation point off to the end of the last COMPLETE UTF-8 sequence at or
    // before the byte cap. Without this, a response cut mid-multi-byte-character leaves a dangling
    // lead/continuation byte at the end of the buffer, and the decoder silently substitutes a
    // U+FFFD replacement glyph for it - right before TruncatedMarker, in what this package calls
    // the audit-visible record of what happened.
    bytes = bytes.subarray(0, lastCompleteUtf8SequenceEnd(bytes, bytes.length));
  }

  const text = new TextDecoder('utf-8').decode(bytes);
  return truncated ? text + HttpMeshServiceDispatcher.TruncatedMarker : text;
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  if (chunks.length === 1) {
    return chunks[0]!;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Given `length` raw bytes of (possibly cut-off) UTF-8 in `bytes`, returns the largest prefix
 * length &lt;= `length` that ends on a complete UTF-8 sequence boundary - i.e. never inside a
 * multi-byte character. Scans backward from the cap for at most 3 bytes (the longest UTF-8 sequence
 * is 4 bytes, so a sequence start can be at most 3 bytes before the cut) looking for a lead byte
 * whose declared sequence length would run past `length`; if found, the cut lands before that lead
 * byte. A cap that lands cleanly on a boundary returns `length` unchanged. Port of the C#
 * `LastCompleteUtf8SequenceEnd`.
 */
function lastCompleteUtf8SequenceEnd(bytes: Uint8Array, length: number): number {
  const scanFloor = Math.max(0, length - 3);
  for (let i = length - 1; i >= scanFloor; i--) {
    const b = bytes[i]!;
    if ((b & 0b1100_0000) === 0b1000_0000) {
      // A UTF-8 continuation byte (10xxxxxx) - not a sequence start, keep scanning backward.
      continue;
    }

    // b is either single-byte ASCII (0xxxxxxx) or the lead byte of a multi-byte sequence
    // (11xxxxxx) - this is where the last sequence in the buffer starts.
    let sequenceLength: number;
    if (b <= 0x7f) {
      sequenceLength = 1;
    } else if (b >= 0xc0 && b <= 0xdf) {
      sequenceLength = 2;
    } else if (b >= 0xe0 && b <= 0xef) {
      sequenceLength = 3;
    } else if (b >= 0xf0 && b <= 0xf7) {
      sequenceLength = 4;
    } else {
      // 0xF8-0xFF is not a valid UTF-8 lead byte at all - there is no well-formed sequence to back
      // off to; leave the cut where it was rather than guessing.
      sequenceLength = 0;
    }

    return sequenceLength > 0 && i + sequenceLength > length ? i : length;
  }

  // No sequence start found within the last 3 bytes (an implausibly long continuation-byte run) -
  // leave the cut where it was; this isn't the mid-character-cut case this guards.
  return length;
}

function resolveInvokeUrl(entry: MeshServiceRegistryEntry): string {
  const explicitUrl = entry.sourceOptions?.[InvokeUrlOption];
  if (explicitUrl !== undefined && explicitUrl.trim() !== '') {
    return explicitUrl;
  }

  if (entry.specUrl.trim() === '') {
    throw new Error(
      `Mesh service "${entry.name}" has no "${InvokeUrlOption}" in sourceOptions and no specUrl to derive an invoke URL from.`,
    );
  }

  return new URL(entry.specUrl).origin + DefaultInvokePath;
}
