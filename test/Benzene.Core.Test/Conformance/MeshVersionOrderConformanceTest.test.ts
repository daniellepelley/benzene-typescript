/**
 * Runs docs/specification/conformance/mesh-version-order-cases.json (mesh.md §2.5) against
 * `@benzenejs/mesh-contracts`' `MeshVersionOrder` - the port of
 * test/Benzene.Conformance.Test/MeshVersionOrderConformanceTest.cs.
 *
 * A pure-function fixture rather than an envelope one: each `compare` case gives two declared service
 * versions of ONE service and the exact outcome a conformant comparison must produce; each `parse`
 * case asserts whether a value is valid under a declared scheme.
 *
 * It exists because "sortable" is not a specification and a comparator is. `"10"` and `"9"` order one
 * way as integers and the opposite way as strings, so two ports that each infer a scheme will disagree
 * about which release is newer - inside a tool used to decide deployments. Pinning the three
 * comparators here is what stops that.
 */
import { describe, expect, it } from 'vitest';
import { MeshVersionOrder, MeshVersionOrdering } from '@benzenejs/mesh-contracts';
import { load } from './ConformanceFixtures';

interface CompareCase {
  name: string;
  /** Set when both sides share one scheme; otherwise the per-side fields carry it. */
  scheme?: string | null;
  leftScheme?: string | null;
  rightScheme?: string | null;
  left: string;
  right: string;
  /** -1, 0, 1, or the string "not-orderable". */
  expected: number | string;
}

interface ParseCase {
  name: string;
  scheme: string;
  value: string;
  valid: boolean;
}

interface OrderFixture {
  compare: CompareCase[];
  parse: ParseCase[];
}

const fixture = load<OrderFixture>('mesh-version-order-cases.json');

function expectedOrdering(expected: number | string): MeshVersionOrdering {
  if (typeof expected === 'string') {
    return MeshVersionOrdering.notOrderable;
  }
  return expected < 0
    ? MeshVersionOrdering.earlier
    : expected > 0
      ? MeshVersionOrdering.later
      : MeshVersionOrdering.same;
}

describe('MeshVersionOrderConformanceTest', () => {
  describe('Compare_MatchesTheFixture', () => {
    for (const testCase of fixture.compare) {
      it(testCase.name, () => {
        const leftScheme = testCase.leftScheme ?? testCase.scheme;
        const rightScheme = testCase.rightScheme ?? testCase.scheme;

        const actual = MeshVersionOrder.compareWire(leftScheme, testCase.left, rightScheme, testCase.right);

        expect(actual).toBe(expectedOrdering(testCase.expected));
      });
    }
  });

  describe('Compare_IsAntisymmetric', () => {
    for (const testCase of fixture.compare) {
      it(testCase.name, () => {
        // Not in the fixture, and it should not be: the fixture pins the contract, and this pins that
        // our implementation of it is a coherent order rather than a pile of special cases. Swapping
        // the operands must swap the answer - an asymmetric comparator would sort differently
        // depending on the order it happened to encounter versions in.
        const leftScheme = testCase.leftScheme ?? testCase.scheme;
        const rightScheme = testCase.rightScheme ?? testCase.scheme;

        const forward = MeshVersionOrder.compareWire(leftScheme, testCase.left, rightScheme, testCase.right);
        const backward = MeshVersionOrder.compareWire(rightScheme, testCase.right, leftScheme, testCase.left);

        const mirrored =
          forward === MeshVersionOrdering.earlier
            ? MeshVersionOrdering.later
            : forward === MeshVersionOrdering.later
              ? MeshVersionOrdering.earlier
              : forward;

        expect(backward).toBe(mirrored);
      });
    }
  });

  describe('Parse_MatchesTheFixture', () => {
    for (const testCase of fixture.parse) {
      it(testCase.name, () => {
        const scheme = MeshVersionOrder.tryParseScheme(testCase.scheme);
        if (scheme === undefined) {
          // An unknown scheme name is itself a rejection - the set is closed, and a port meeting a
          // scheme it does not know must refuse rather than fall back to string comparison.
          expect(testCase.valid).toBe(false);
          return;
        }

        expect(MeshVersionOrder.isValid(scheme, testCase.value)).toBe(testCase.valid);
      });
    }
  });

  it('AnInvalidValueIsNeverOrderable', () => {
    // The build that declared it is the cheapest place to catch a mismatch. If one slips through
    // anyway, the comparison must decline rather than produce a confident wrong answer.
    const actual = MeshVersionOrder.compareWire('integer', '1.3.0', 'integer', '42');

    expect(actual).toBe(MeshVersionOrdering.notOrderable);
  });
});
