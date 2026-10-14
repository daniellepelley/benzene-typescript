/**
 * Port of the wire-facing half of Benzene.Test.Mesh.Wire.MeshIssuesTest (spec §4.1): the classification
 * precedence table and the normative fingerprint recipe. The C# suite's emitter-middleware cases
 * (`UseMeshIssues`/`IMeshIssueExporter`/`MeshIssueOccurrence`) are the mesh service-side emitter, not part of
 * `@benzenejs/mesh-wire`'s ported surface, so they are out of scope here.
 *
 * `MeshIssueErrors` (the issue's `errors` detail, spec 1.2 candidate §4.1) has no C# counterpart yet; its
 * cases are written from mesh.md: the bound and order, the merge by identity, and the lenient decode.
 */
import { describe, expect, it } from 'vitest';
import {
  MeshIssue,
  MeshIssueClassification,
  MeshIssueError,
  MeshIssueErrors,
  MeshIssueFingerprint,
  MeshJson,
} from '@benzenejs/mesh-wire';

function entry(field: string | undefined, code: string | undefined, count: number): MeshIssueError {
  const value = new MeshIssueError();
  if (field !== undefined) value.field = field;
  if (code !== undefined) value.code = code;
  value.count = count;
  return value;
}

describe('MeshIssueClassification', () => {
  it('Classification_FollowsThePrecedenceTable', () => {
    // 1. Validation statuses win even when an exception was thrown.
    expect(MeshIssueClassification.classify('bad-request', 'SyntaxError')).toBe(MeshIssueClassification.validation);
    expect(MeshIssueClassification.classify('validation-error', undefined)).toBe(MeshIssueClassification.validation);
    // 2. A thrown-and-converted failure classifies by its throw, not its mapped status.
    expect(MeshIssueClassification.classify('service-unavailable', 'TypeError')).toBe(MeshIssueClassification.exception);
    // 3. Wiring/config drift, including the empty-status wiring gap; unauthorized is config, not dependency.
    expect(MeshIssueClassification.classify('not-found', undefined)).toBe(MeshIssueClassification.configWiring);
    expect(MeshIssueClassification.classify('unauthorized', undefined)).toBe(MeshIssueClassification.configWiring);
    expect(MeshIssueClassification.classify('', undefined)).toBe(MeshIssueClassification.configWiring);
    // 4. Dependency only when nothing was thrown.
    expect(MeshIssueClassification.classify('service-unavailable', undefined)).toBe(MeshIssueClassification.dependency);
    expect(MeshIssueClassification.classify('timeout', undefined)).toBe(MeshIssueClassification.dependency);
    // 5-6. The wire's unclassified-failure status is exception-shaped; anything else is honest.
    expect(MeshIssueClassification.classify('unexpected-error', undefined)).toBe(MeshIssueClassification.exception);
    expect(MeshIssueClassification.classify('conflict', undefined)).toBe(MeshIssueClassification.unclassified);
  });
});

describe('MeshIssueFingerprint', () => {
  it('Fingerprint_FollowsTheNormativeRecipe', () => {
    // Deterministic, 32 lowercase hex chars, exceptionType preferred as the discriminator, transport never
    // part of the identity.
    const a = MeshIssueFingerprint.compute('orders', 'order:create', 'v2', 'exception', 'System.TimeoutException', 'service-unavailable');
    const b = MeshIssueFingerprint.compute('orders', 'order:create', 'v2', 'exception', 'System.TimeoutException', 'timeout');
    const c = MeshIssueFingerprint.compute('orders', 'order:create', 'v2', 'dependency', undefined, 'timeout');

    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toBe(a); // same discriminator (the exception type) -> same identity
    expect(c).not.toBe(a); // different classification/discriminator -> different identity
    // The spec's worked derivation: sha256("orders|order:create|v2|exception|System.TimeoutException")[..16] hex.
    expect(MeshIssueFingerprint.compute('orders', 'order:create', 'v2', 'exception', undefined, 'System.TimeoutException')).toBe(a);
  });
});

describe('MeshIssueErrors', () => {
  it('Bound_KeepsTheTenHighestCounts_OrderedByCountThenFieldThenCode_AbsentFirst', () => {
    // Twelve entries; the two dropped are the lowest count with the greatest field. Within a count, an absent
    // field sorts before every field, and within a field an absent code before every code (ordinal).
    const entries = [
      entry('/b', 'required', 1),
      entry('/a', 'required', 1),
      entry('/a', undefined, 1),
      entry(undefined, 'z', 1),
      entry('/k', 'required', 5),
      entry('/a', 'max', 1),
      entry('/c', 'required', 1),
      entry('/d', 'required', 1),
      entry('/e', 'required', 1),
      entry('/f', 'required', 1),
      entry('/g', 'required', 1),
      entry('/B', 'required', 1), // 'B' < 'a' < 'b' in code-unit order, not locale order
    ];

    const bounded = MeshIssueErrors.bound(entries);

    expect(MeshIssueErrors.maxEntries).toBe(10);
    expect(bounded.map((e) => [e.field, e.code, e.count])).toEqual([
      ['/k', 'required', 5],
      [undefined, 'z', 1],
      ['/B', 'required', 1],
      ['/a', undefined, 1],
      ['/a', 'max', 1],
      ['/a', 'required', 1],
      ['/b', 'required', 1],
      ['/c', 'required', 1],
      ['/d', 'required', 1],
      ['/e', 'required', 1],
    ]);
    expect(entries).toHaveLength(12); // the input is not mutated
  });

  it('Merge_AnEmptyMemberIsTheAbsentOne_AndIsOmittedFromTheWire', () => {
    // Spec §4.1 (amended): an empty string is the same as an absent member - one identity, sorted first.
    const merged = MeshIssueErrors.merge(
      [entry('', 'TotalsDisagree', 2), entry('/a', 'required', 2)],
      [entry(undefined, 'TotalsDisagree', 1), entry('/a', '', 1)],
    );

    expect(JSON.parse(MeshJson.serialize(merged))).toEqual([
      { code: 'TotalsDisagree', count: 3 },
      { field: '/a', code: 'required', count: 2 },
      { field: '/a', count: 1 },
    ]);
  });

  it('Merge_SumsDeltasByFieldAndCodeIdentity_AnAbsentMemberBeingItsOwnIdentity', () => {
    const existing = [entry('/orderId', 'required', 3), entry('/quantity', 'GreaterThanValidator', 1)];
    const incoming = [
      entry('/quantity', 'GreaterThanValidator', 3),
      entry('/quantity', undefined, 2), // same field, absent code: a different entry
      entry(undefined, 'TotalsDisagree', 1),
    ];

    const merged = MeshIssueErrors.merge(existing, incoming);

    expect(merged.map((e) => [e.field, e.code, e.count])).toEqual([
      ['/quantity', 'GreaterThanValidator', 4],
      ['/orderId', 'required', 3],
      ['/quantity', undefined, 2],
      [undefined, 'TotalsDisagree', 1],
    ]);
    expect(existing[1].count).toBe(1); // neither side is mutated
    expect(MeshIssueErrors.merge(undefined, undefined)).toEqual([]);
  });

  it('Decode_SkipsMalformedEntries_NeverThrows', () => {
    const decoded = MeshIssueErrors.decode([
      'required', // not an object
      null,
      ['/a', 'required', 1], // an array is not an entry object
      { count: 1 }, // neither field nor code
      { field: 42, code: null, count: 1 }, // non-string members are absent -> neither
      { field: '/a', count: 0 }, // count not positive
      { field: '/a', count: -2 },
      { field: '/a', count: 1.5 }, // count not an integer
      { field: '/a', count: '2' }, // count not a number
      { field: '/a', code: 'required' }, // count missing
      { field: '', code: '', count: 1 }, // both members empty: an empty string is an absent member -> neither
      { field: '', count: 4 },
      { field: '/b', code: 'required', count: 2 }, // the one valid entry
      { code: 'TotalsDisagree', count: 1, message: 'totals for order 42 disagree' }, // message is never carried
      { field: '', code: 'RangeCheck', count: 3 }, // kept: the empty field reads as absent
    ]);

    expect(decoded).toHaveLength(3);
    expect(JSON.parse(MeshJson.serialize(decoded[2]))).toEqual({ code: 'RangeCheck', count: 3 });
    expect(decoded[0]).toEqual(entry('/b', 'required', 2));
    expect(decoded[1]).toEqual(entry(undefined, 'TotalsDisagree', 1));
    // On the wire: the absent field omitted, and the message never carried.
    expect(JSON.parse(MeshJson.serialize(decoded[1]))).toEqual({ code: 'TotalsDisagree', count: 1 });
    // A member that is not an array reads as no entries.
    expect(MeshIssueErrors.decode(undefined)).toEqual([]);
    expect(MeshIssueErrors.decode({ field: '/a', count: 1 })).toEqual([]);
  });

  it('Serialize_OmitsAbsentMembers_AndAnIssueWithoutErrors', () => {
    const issue = new MeshIssue();
    expect(JSON.parse(MeshJson.serialize(issue))).not.toHaveProperty('errors');

    issue.errors = [entry(undefined, 'TotalsDisagree', 1)];
    expect(JSON.parse(MeshJson.serialize(issue)).errors).toEqual([{ code: 'TotalsDisagree', count: 1 }]);
  });
});
