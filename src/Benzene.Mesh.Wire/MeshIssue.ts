/** Port of Benzene.Mesh.Wire.MeshIssue (and its MeshIssueBatch/MeshIssueClassification/MeshIssueFingerprint). */
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
