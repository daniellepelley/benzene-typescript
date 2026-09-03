/**
 * Port of test/Benzene.Mesh.Test/MeshVersionOrderTest.cs.
 *
 * The derived helpers over mesh.md §2.5's ordering - the ones a reader's questions actually reduce
 * to. The comparator itself is pinned by the language-neutral fixture
 * (`mesh-version-order-cases.json`, run by `MeshVersionOrderConformanceTest`) and is not re-tested
 * here.
 *
 * Every one of these has an `undefined` or NOT ORDERABLE arm, and those arms are the point. "Newest
 * version" and "four versions behind" are figures that go straight in front of a reader deciding a
 * deployment; answering either from a set that cannot be ordered would put an unfounded number on
 * screen. `DateTimeOffset` -> epoch-millisecond `number`; C# `null` returns -> `undefined`.
 */
import { describe, expect, it } from 'vitest';
import { MeshServiceVersion, MeshVersionOrder, MeshVersionScheme } from '@benzenejs/mesh-contracts';

function build(value: string): MeshServiceVersion {
  return { value, scheme: MeshVersionScheme.integer };
}

function semver(value: string): MeshServiceVersion {
  return { value, scheme: MeshVersionScheme.semver };
}

describe('MeshVersionOrderTest', () => {
  it('Latest_PicksTheNewestBuild', () => {
    const latest = MeshVersionOrder.latest([build('9'), build('41'), build('10')]);

    // Not "41" by string comparison, which would pick "9".
    expect(latest).toEqual(build('41'));
  });

  it('Latest_IsUndefinedAcrossASchemeChange', () => {
    // A service that switched from build numbers to SemVer has a real discontinuity. There is no
    // newest version across it, and a tip composition built on a guess would be worse than none.
    const latest = MeshVersionOrder.latest([build('41'), semver('1.3.0')]);

    expect(latest).toBeUndefined();
  });

  it('Latest_IsUndefinedWhenAValueDoesNotParseUnderItsScheme', () => {
    expect(MeshVersionOrder.latest([build('41'), build('1.3.0')])).toBeUndefined();
  });

  it('Latest_IsUndefinedForAnEmptySet', () => {
    // No versions is not version zero.
    expect(MeshVersionOrder.latest([])).toBeUndefined();
  });

  it('Distance_CountsTheVersionsBetween', () => {
    const known = [build('40'), build('41'), build('42'), build('43')];

    expect(MeshVersionOrder.distance(build('40'), build('43'), known)).toBe(3);
  });

  it('Distance_CountsBySTEPSNotByArithmetic', () => {
    // "Four versions behind" means four releases, not a subtraction of build numbers. A pipeline
    // that skips numbers - a failed build, a retagged artifact - would otherwise inflate the gap.
    const known = [build('10'), build('20'), build('30')];

    expect(MeshVersionOrder.distance(build('10'), build('30'), known)).toBe(2);
  });

  it('Distance_IsZeroForTheSameVersion', () => {
    const known = [build('41'), build('42')];

    expect(MeshVersionOrder.distance(build('42'), build('42'), known)).toBe(0);
  });

  it('Distance_IsUndefinedWhenAnEndpointIsNotInTheKnownSet', () => {
    // The catalogue does not contain that build, so the count is unknown - never zero, which would
    // read as "up to date".
    const known = [build('40'), build('41')];

    expect(MeshVersionOrder.distance(build('40'), build('99'), known)).toBeUndefined();
  });

  it('Distance_IsUndefinedAcrossASchemeChange', () => {
    const known = [build('41'), semver('1.3.0')];

    expect(MeshVersionOrder.distance(build('41'), semver('1.3.0'), known)).toBeUndefined();
  });

  it('DisagreesWithBuildTime_IsFalseWhenTheOrdersAgree', () => {
    const earlier = Date.UTC(2026, 7, 1);
    const later = Date.UTC(2026, 7, 2);

    expect(MeshVersionOrder.disagreesWithBuildTime(build('42'), later, build('41'), earlier)).toBe(false);
  });

  it('DisagreesWithBuildTime_IsTrueWhenALaterVersionWasBuiltEarlier', () => {
    // The finding mesh.md §2.5 asks to be surfaced: an out-of-order pipeline, a rebuilt artifact,
    // or a backdated tag. Worth telling somebody about rather than reconciling silently by
    // preferring one field over the other.
    const earlier = Date.UTC(2026, 7, 1);
    const later = Date.UTC(2026, 7, 2);

    expect(MeshVersionOrder.disagreesWithBuildTime(build('42'), earlier, build('41'), later)).toBe(true);
  });

  it('DisagreesWithBuildTime_IsFalseWhenTheTwoAreNotOrderable', () => {
    // Nothing to disagree with. Reporting a disagreement here would be inventing an order to
    // contradict.
    const earlier = Date.UTC(2026, 7, 1);
    const later = Date.UTC(2026, 7, 2);

    expect(MeshVersionOrder.disagreesWithBuildTime(build('42'), earlier, semver('1.3.0'), later)).toBe(false);
  });

  it('Describe_NamesTheSchemeSoAReaderKnowsWhichOrderApplies', () => {
    expect(MeshVersionOrder.describe(build('42'))).toBe('42 (integer)');
  });

  it('SchemeNamesRoundTripThroughTheWire', () => {
    for (const scheme of Object.values(MeshVersionScheme)) {
      expect(MeshVersionOrder.tryParseScheme(MeshVersionOrder.schemeName(scheme))).toBe(scheme);
    }
  });

  it('AnUnknownSchemeNameIsRejectedRatherThanDefaulted', () => {
    // §2.5: the set is closed and there is no default. A silent fallback to string comparison is
    // indistinguishable from a correct answer, which is what makes it dangerous.
    expect(MeshVersionOrder.tryParseScheme('calver')).toBeUndefined();
    expect(MeshVersionOrder.tryParseScheme(null)).toBeUndefined();
    expect(MeshVersionOrder.tryParseScheme(undefined)).toBeUndefined();
  });
});
