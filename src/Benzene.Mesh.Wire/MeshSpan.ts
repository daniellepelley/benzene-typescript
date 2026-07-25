/** Port of Benzene.Mesh.Wire.MeshSpan (and its package-local Traceparent helper). */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

const ambient = new AsyncLocalStorage<MeshSpan | undefined>();

/**
 * The current invocation's position in a trace: the ids the trace middleware assigned (or adopted
 * from the caller's traceparent) for the event it will export. A handler making a downstream Benzene
 * call forwards `toTraceparent()` as the `traceparent` header (docs/specification/mesh.md §3) - the
 * join that lets a collector derive consumer edges from parentage.
 *
 * Flows via `MeshSpan.current` (`AsyncLocalStorage`, the Node idiom for invocation-ambient state,
 * the port of C# `AsyncLocal`). Where C# sets `MeshSpan.Current = span` and restores it in a
 * `finally`, the port scopes the span with `MeshSpan.runWith(span, () => next())`: the store is the
 * active span for the whole downstream async flow and reverts automatically when it completes, so
 * nested invocations restore the caller's span exactly as the C# finally does.
 */
export class MeshSpan {
  constructor(
    readonly traceId: string,
    readonly spanId: string,
  ) {}

  /**
   * The traced invocation currently executing on this async flow, or `undefined` when unmeshed -
   * per the spec's degradation rule, a caller then simply sends no traceparent header.
   */
  static get current(): MeshSpan | undefined {
    return ambient.getStore();
  }

  /** Runs `fn` with `span` as the ambient `current` for its entire (possibly async) duration. */
  static runWith<T>(span: MeshSpan | undefined, fn: () => T): T {
    return ambient.run(span, fn);
  }

  /**
   * Renders the span as a W3C traceparent header value: version 00, this span as the parent-id,
   * sampled flag set.
   */
  toTraceparent(): string {
    return `00-${this.traceId}-${this.spanId}-01`;
  }
}

/** The successful result of parsing a W3C traceparent header. */
export interface TraceparentIds {
  traceId: string;
  parentSpanId: string;
}

/**
 * W3C traceparent parsing per docs/specification/mesh.md §3: absent or malformed values (wrong
 * segment count/length, non-hex, or the all-zero ids the W3C spec defines as invalid) yield
 * `undefined`, and the trace middleware starts a fresh trace - a bad caller header degrades
 * correlation, never the invocation.
 */
export const Traceparent = {
  tryParse(header: string | undefined): TraceparentIds | undefined {
    if (!header) {
      return undefined;
    }

    const parts = header.split('-');
    if (
      parts.length !== 4 ||
      parts[0]!.length !== 2 ||
      parts[1]!.length !== 32 ||
      parts[2]!.length !== 16 ||
      parts[3]!.length !== 2 ||
      !isLowerHex(parts[0]!) ||
      !isLowerHex(parts[1]!) ||
      !isLowerHex(parts[2]!) ||
      !isLowerHex(parts[3]!) ||
      parts[1] === '0'.repeat(32) ||
      parts[2] === '0'.repeat(16)
    ) {
      return undefined;
    }

    return { traceId: parts[1]!, parentSpanId: parts[2]! };
  },

  /**
   * A fresh random id of `bytes` bytes, lowercase hex. Trace/span ids need uniqueness, not
   * unpredictability (the port of C# `RandomNumberGenerator.GetBytes`).
   */
  newId(bytes: number): string {
    return randomBytes(bytes).toString('hex');
  },
} as const;

function isLowerHex(value: string): boolean {
  return /^[0-9a-f]+$/.test(value);
}
