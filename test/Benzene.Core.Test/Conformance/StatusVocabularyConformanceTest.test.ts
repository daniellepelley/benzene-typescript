/**
 * Runs docs/specification/conformance/status-vocabulary.json against the TypeScript port's status
 * constants and success classification (wire-contracts.md section 3). Port of the .NET
 * StatusVocabularyConformanceTest (Benzene.Conformance.Test/StatusMappingConformanceTest.cs).
 *
 * The fixture is the neutral truth for the wire status vocabulary. This test pins that (a) the port's
 * `BenzeneResultStatus` constants are exactly the fixture's status set, and (b) every classifier the
 * port exposes agrees with the fixture's `isSuccess` flag.
 */
import { describe, expect, it } from 'vitest';
import { BenzeneResultStatus } from '@benzenejs/results';
import { BenzeneResultHttpMapper } from '@benzenejs/clients';
import { load } from './ConformanceFixtures';

interface VocabularyRow {
  status: string;
  isSuccess: boolean;
}

interface VocabularyFixture {
  statuses: VocabularyRow[];
}

const fixture = load<VocabularyFixture>('status-vocabulary.json');

/**
 * The port's status constants: the string-valued members of the `BenzeneResultStatus` object (its
 * `isSuccess`/`isFailure`/... members are functions and excluded). This is the TS analogue of the .NET
 * test reflecting over `BenzeneResultStatus`'s literal `const` fields.
 */
const constants = Object.values(BenzeneResultStatus)
  .filter((value) => typeof value === 'string')
  .map((value) => value as string);

describe('StatusVocabularyConformanceTest', () => {
  it('matches the BenzeneResultStatus constants', () => {
    const fixtureStatuses = fixture.statuses.map((x) => x.status).sort();
    expect([...constants].sort()).toEqual(fixtureStatuses);
  });

  describe('success classification matches', () => {
    for (const row of fixture.statuses) {
      it(row.status, () => {
        expect(BenzeneResultHttpMapper.isSuccessStatus(row.status)).toBe(row.isSuccess);
        expect(BenzeneResultStatus.isSuccess(row.status)).toBe(row.isSuccess);
        expect(BenzeneResultStatus.isFailure(row.status)).toBe(!row.isSuccess);
        expect(BenzeneResultStatus.isKnown(row.status)).toBe(true);
      });
    }
  });
});
