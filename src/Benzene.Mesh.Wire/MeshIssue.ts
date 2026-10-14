/**
 * Port of Benzene.Mesh.Wire.MeshIssue (and its MeshIssueBatch/MeshIssueClassification/MeshIssueFingerprint).
 * `MeshIssueError`/`MeshIssueErrors` (the issue's `errors` detail, spec §4.1) implement the spec 1.2 candidate
 * directly from mesh.md, ahead of a .NET counterpart.
 */
import { createHash } from 'node:crypto';

/**
 * One deduplicated, classified failure signature (spec §4.1) - the pipeline-native answer to "what is
 * wrong", where a trace answers "what happened". Sparse by construction: emitted on failure only,
 * fingerprint-deduplicated at source. Wire field names are camelCase; optional fields are `undefined` (not
 * `null`) so `MeshJson.serialize` omits them (the C# `WhenWritingNull`). `DateTimeOffset firstSeen/lastSeen`
 * -> epoch-millisecond `number`.
 */
export class MeshIssue {
  /**
   * Normative identity (spec §4.1): lowercase hex of the first 16 bytes of SHA-256 over
   * `service|topic|version|classification|discriminator` - see {@link MeshIssueFingerprint}.
   */
  fingerprint = '';

  /** One of {@link MeshIssueClassification}'s closed vocabulary. */
  classification = '';

  service = '';

  topic = '';

  version?: string;

  /**
   * Descriptive only - deliberately NOT part of the fingerprint (the same failure over two transports is
   * one issue).
   */
  transport?: string;

  /** The Benzene status verbatim (wire-contracts §3). */
  status = '';

  /** The thrown exception's language-native type name - never a message or stack trace. */
  exceptionType?: string;

  /**
   * DELTA: occurrences since the emitter's previous successful flush, never cumulative (spec §4.1 - deltas
   * merge restart-proof with no instance identity on the wire).
   */
  count = 0;

  /** Epoch milliseconds (the port of C# `DateTimeOffset FirstSeen`). */
  firstSeen = 0;

  /** Epoch milliseconds (the port of C# `DateTimeOffset LastSeen`). */
  lastSeen = 0;

  /** The newest observed trace ids for this issue (≤3) - the bridge to the evidence plane. */
  exemplarTraceIds: string[] = [];

  /**
   * Optional key into a remediation catalog (spec §4.1 registered keys: `no-handler`, `deserialization`) -
   * never prose. Unknown keys are tolerated by readers.
   */
  resolutionHint?: string;

  /**
   * The structured detail behind the failures this issue counts (spec §4.1): the failing results'
   * problem-document `(field, code)` pairs - never the `message` - each with a DELTA count like
   * {@link count}, at most {@link MeshIssueErrors.maxEntries} of them in {@link MeshIssueErrors.order}.
   * `undefined` (omitted on the wire) when there are none. Not part of the fingerprint.
   */
  errors?: MeshIssueError[];
}

/**
 * One entry of an issue's error detail (spec §4.1). Its identity is the (`field`, `code`) pair - an empty
 * string being the same as an absent member (`undefined`), which is distinct from every non-empty string - and
 * it carries at least one of the two. `message`
 * is deliberately not a member: it is free text a validator may have built from the payload.
 */
export class MeshIssueError {
  /** The problem-document error's `field` (a JSON Pointer into the request), when it carried one. */
  field?: string;

  /** The problem-document error's `code`, when it carried one. */
  code?: string;

  /** DELTA on the wire, exactly as {@link MeshIssue.count} is; cumulative once a collector has merged it. */
  count = 0;
}

/**
 * The spec §4.1 rules for {@link MeshIssue.errors}, shared by every side that holds them: the bound and
 * order, the merge by identity, and the lenient reading of a received `errors` member.
 */
export const MeshIssueErrors = {
  /** Both sides keep at most this many entries per issue (spec §4.1). */
  maxEntries: 10,

  /**
   * The spec §4.1 order: count descending, then `field`, then `code`, each in ordinal (UTF-16 code-unit)
   * order with an absent member first.
   */
  order(a: MeshIssueError, b: MeshIssueError): number {
    return b.count - a.count || compareMember(a.field, b.field) || compareMember(a.code, b.code);
  },

  /** The highest {@link maxEntries} entries, in {@link order}. Returns a new array. */
  bound(entries: readonly MeshIssueError[]): MeshIssueError[] {
    return [...entries].sort(MeshIssueErrors.order).slice(0, MeshIssueErrors.maxEntries);
  },

  /**
   * Merges `incoming` into `existing` by (`field`, `code`) identity - `count += delta` - then applies
   * {@link bound}. Either side may be `undefined`; neither is mutated. Returns new entries.
   */
  merge(
    existing: readonly MeshIssueError[] | undefined,
    incoming: readonly MeshIssueError[] | undefined,
  ): MeshIssueError[] {
    const merged = new Map<string, MeshIssueError>();
    for (const entry of [...(existing ?? []), ...(incoming ?? [])]) {
      const key = identityOf(entry);
      const held = merged.get(key);
      if (held === undefined) {
        merged.set(key, errorOf(entry.field, entry.code, entry.count));
      } else {
        held.count += entry.count;
      }
    }
    return MeshIssueErrors.bound([...merged.values()]);
  },

  /**
   * Reads a received `errors` member leniently (spec §4.1): an entry that is not an object, carries neither
   * a non-empty string `field` nor a non-empty string `code` (an empty string is an absent member), or whose
   * `count` is not a positive integer is skipped - never the
   * issue or the batch it arrived in. A member that is not an array reads as no entries. The result is not
   * merged or bounded; {@link merge} does that.
   */
  decode(value: unknown): MeshIssueError[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const entries: MeshIssueError[] = [];
    for (const item of value as unknown[]) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const field = memberOf(record.field);
      const code = memberOf(record.code);
      const count = record.count;
      if ((field === undefined && code === undefined) || typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
        continue;
      }
      entries.push(errorOf(field, code, count));
    }
    return entries;
  },
} as const;

// A member as spec §4.1 reads it: a non-empty string, else absent (an empty string is the same as an absent one).
function memberOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function errorOf(field: string | undefined, code: string | undefined, count: number): MeshIssueError {
  const entry = new MeshIssueError();
  // Assigned only when present (non-empty), so an absent member is omitted from the wire, never written as
  // null or as the empty string it is equal to.
  if (field !== undefined && field.length > 0) {
    entry.field = field;
  }
  if (code !== undefined && code.length > 0) {
    entry.code = code;
  }
  entry.count = count;
  return entry;
}

// The (field, code) identity as a Map key: an empty member is the absent one (null), which JSON keeps distinct
// from every non-empty string.
function identityOf(entry: MeshIssueError): string {
  return JSON.stringify([memberOf(entry.field) ?? null, memberOf(entry.code) ?? null]);
}

// Ordinal, absent (or empty, the same thing) first.
function compareMember(x: string | undefined, y: string | undefined): number {
  const a = memberOf(x);
  const b = memberOf(y);
  if (a === b) {
    return 0;
  }
  if (a === undefined) {
    return -1;
  }
  if (b === undefined) {
    return 1;
  }
  return a < b ? -1 : 1;
}

/**
 * The body of a `benzene:mesh:issues` message (spec §4.1): one emitter flush. The batch-level {@link service} is
 * REQUIRED even though each issue carries its own - an EMPTY batch is the feed's liveness assertion ("feed
 * alive, nothing failing") and must be attributable.
 */
export class MeshIssueBatch {
  service = '';

  issues: MeshIssue[] = [];
}

/**
 * The closed classification vocabulary and its normative precedence table (spec §4.1). C# `static class` of
 * `const string`s + a `Classify` method -> a frozen object; the string VALUES are the wire classification
 * tokens (lowercase-kebab, cross-language).
 */
export const MeshIssueClassification = {
  exception: 'exception',
  validation: 'validation',
  configWiring: 'config-wiring',
  dependency: 'dependency',
  /**
   * Reserved for catalog/heartbeat-derived issues (hash mismatch, schema divergence) filed by a collector
   * or reader - never produced by {@link classify}.
   */
  contractDrift: 'contract-drift',
  unclassified: 'unclassified',

  /**
   * The spec §4.1 precedence table, evaluated in order. `status` is the invocation's Benzene status (empty
   * = the §3 wiring gap); `exceptionType` is the captured thrown-exception type, when any.
   */
  classify(status: string | undefined, exceptionType: string | undefined): string {
    switch (status) {
      // 1. Validation statuses classify as validation even when an exception was thrown (a
      //    deserialization/argument exception IS the validation failure; the type still serves as the
      //    fingerprint discriminator).
      case 'bad-request':
      case 'validation-error':
        return MeshIssueClassification.validation;
    }

    // 2. A thrown-and-converted failure classifies by its throw, not its mapped status - this is what stops
    //    every thrown NullReferenceException (mapped to service-unavailable) from reading as a dependency
    //    problem.
    if (exceptionType !== undefined && exceptionType.length > 0) {
      return MeshIssueClassification.exception;
    }

    switch (status) {
      // 3. Wiring/config drift at this boundary (an empty status is normatively a wiring gap).
      case 'not-found':
      case 'unauthorized':
      case 'forbidden':
      case 'not-implemented':
      case undefined:
      case '':
        return MeshIssueClassification.configWiring;

      // 4. Something this service calls is broken (reached only when nothing was thrown - i.e. an explicit
      //    handler result or a client-side send failure).
      case 'service-unavailable':
      case 'timeout':
      case 'too-many-requests':
        return MeshIssueClassification.dependency;

      // 5. The wire's own "unclassified failure" status originates from generic error mapping.
      case 'unexpected-error':
      case 'exception':
        return MeshIssueClassification.exception;

      // 6. An honest fallback beats a lying class (conflict, app-custom statuses, ...).
      default:
        return MeshIssueClassification.unclassified;
    }
  },
} as const;

/** The normative fingerprint derivation (spec §4.1). */
export const MeshIssueFingerprint = {
  /**
   * Lowercase hex of the first 16 bytes of SHA-256 over the UTF-8 bytes of
   * `service|topic|version|classification|discriminator`, where `version` is the empty string when absent
   * and the discriminator is `exceptionType` when present, else `status`. Transport is deliberately
   * excluded. Matches the C# `Convert.ToHexString(sha256(...)[..16]).ToLowerInvariant()` byte-for-byte so
   * the identity is a cross-language wire value.
   */
  compute(
    service: string,
    topic: string,
    version: string | undefined,
    classification: string,
    exceptionType: string | undefined,
    status: string | undefined,
  ): string {
    const discriminator = exceptionType !== undefined && exceptionType.length > 0 ? exceptionType : status ?? '';
    const canonical = `${service}|${topic}|${version ?? ''}|${classification}|${discriminator}`;
    // digest('hex') is the full 32-byte (64 hex-char) SHA-256; the first 16 bytes are its first 32 hex chars.
    return createHash('sha256').update(canonical, 'utf8').digest('hex').substring(0, 32);
  },
} as const;
