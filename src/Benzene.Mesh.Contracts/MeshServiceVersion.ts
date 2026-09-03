/**
 * Port of Benzene.Mesh.Contracts.MeshServiceVersion - the declared service-version identity
 * (mesh.md §2.4) and its ordering rules (§2.5), pinned by `conformance/mesh-version-order-cases.json`.
 *
 * Divergences from the C# original:
 * - The C# enums (`MeshVersionScheme`, `MeshVersionOrdering`) -> `as const` string-constant objects +
 *   union types, matching this repo's loose-string enum convention (`MeshServiceStatus`,
 *   `MeshTopicStatus`); the `MeshVersionOrdering` values are the fixture's own vocabulary, so
 *   `notOrderable` IS the wire string `"not-orderable"`.
 * - The `readonly record struct MeshServiceVersion` -> a plain readonly interface (compare with deep
 *   equality, not reference identity).
 * - The two C# `Compare` overloads -> `compare` (typed) and `compareWire` (wire-form scheme names) -
 *   an object literal can't overload a method, and the two entry points genuinely differ in intent.
 * - `TryParseScheme(name, out scheme)` -> `tryParseScheme(name): MeshVersionScheme | undefined`.
 * - `DateTimeOffset` -> epoch-millisecond `number` (`disagreesWithBuildTime`); `null` returns ->
 *   `undefined` (`latest`, `distance`).
 */

/**
 * How a declared `serviceVersion`'s values are compared (mesh.md §2.5).
 *
 * A closed set, declared on the descriptor and never inferred from the value. `"10"` and `"9"` order
 * one way as integers and the opposite way as strings, so a port that guesses will disagree with a
 * port that guesses differently - about which release is newer, inside a tool used to decide
 * deployments. There is deliberately no default: a version declared without a scheme is an identity,
 * not a position in an order.
 */
export const MeshVersionScheme = {
  /** One or more ASCII digits, compared numerically. The build-counter case. */
  integer: 'integer',

  /** A Semantic Versioning 2.0.0 version, compared by SemVer precedence. */
  semver: 'semver',

  /** Any non-empty string, compared codepoint-wise. */
  lexicographic: 'lexicographic',
} as const;

/** The closed scheme set's values (`'integer' | 'semver' | 'lexicographic'`) - also the wire names. */
export type MeshVersionScheme = (typeof MeshVersionScheme)[keyof typeof MeshVersionScheme];

/**
 * The outcome of comparing two service versions of one service (mesh.md §2.5).
 *
 * `same` is not an assertion that the two are the same version: §2.4 is explicit that service-version
 * identity is extrinsic, so two releases can share a position - two SemVer versions differing only in
 * build metadata, or a zero-padded build number and its unpadded twin. `notOrderable` is a normal
 * outcome, not an error: it arises when the two carry different schemes (a service that switched from
 * build numbers to SemVer has a real discontinuity in its history) or when either declares no scheme
 * at all - inventing an order across such a break would be a claim no data supports.
 */
export const MeshVersionOrdering = {
  /** The left version is earlier in the order. */
  earlier: 'earlier',

  /** The two occupy the same position in the order (NOT the same version - see above). */
  same: 'same',

  /** The left version is later in the order. */
  later: 'later',

  /** The two cannot be placed in one order, and no comparison is offered. */
  notOrderable: 'not-orderable',
} as const;

/** The comparison outcomes (`'earlier' | 'same' | 'later' | 'not-orderable'`). */
export type MeshVersionOrdering = (typeof MeshVersionOrdering)[keyof typeof MeshVersionOrdering];

/** A declared service version and the rule for comparing it (mesh.md §2.4 identity, §2.5 order). */
export interface MeshServiceVersion {
  readonly value: string;
  readonly scheme: MeshVersionScheme;
}

/** The wire names of the closed scheme set. Anything else is rejected, never defaulted. */
const schemes: ReadonlyMap<string, MeshVersionScheme> = new Map([
  ['integer', MeshVersionScheme.integer],
  ['semver', MeshVersionScheme.semver],
  ['lexicographic', MeshVersionScheme.lexicographic],
]);

/** One or more ASCII digits. No sign, no separators, no decimal point. */
const integerPattern = /^[0-9]+$/;

/** The Semantic Versioning 2.0.0 grammar, verbatim from semver.org. */
const semverPattern = new RegExp(
  '^(?<major>0|[1-9]\\d*)\\.(?<minor>0|[1-9]\\d*)\\.(?<patch>0|[1-9]\\d*)' +
    '(?:-(?<prerelease>(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)' +
    '(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?' +
    '(?:\\+(?<build>[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$',
);

/**
 * Ordering for declared service versions - mesh.md §2.5, pinned by
 * `conformance/mesh-version-order-cases.json`.
 *
 * Order is what separates a difference from a direction: without it, comparing two releases can only
 * report that they differ; with it the same comparison reports an *upgrade* or a *rollback*, which is
 * the question anyone planning a deployment is actually asking.
 *
 * Three rules this type exists to keep, all of which are easy to break by being helpful:
 * - **The scheme is declared, never inferred.** Nothing here sniffs a value to decide how to compare it.
 * - **Order is only defined within one service.** There is no global version line, so this type
 *   deliberately offers no way to compare across services - the caller holds the service identity.
 * - **Order is not lineage.** {@link MeshVersionOrdering.later} says which version came after, never
 *   which contains the other. A hotfix cut from a release branch while trunk moved on orders correctly
 *   and is an ancestor of nothing.
 *
 * `createdAtUtc` is not a substitute and not a tiebreak, which is why no clock appears here. Build
 * timestamps go backwards in practice - rebuilt artifacts, clock skew, pipelines finishing out of
 * order - so a comparator that quietly fell back to one would produce a confident wrong answer exactly
 * when the pipeline was misbehaving.
 */
export const MeshVersionOrder = {
  /**
   * Resolves a wire scheme name, or `undefined` for an unknown one - a port meeting a scheme it does
   * not know must reject it rather than fall back to string comparison, because a silent fallback is
   * indistinguishable from a correct answer.
   */
  tryParseScheme(name: string | null | undefined): MeshVersionScheme | undefined {
    return name == null ? undefined : schemes.get(name);
  },

  /** The wire name for a scheme (the union values ARE the wire names; kept for C# API parity). */
  schemeName(scheme: MeshVersionScheme): string {
    return scheme;
  },

  /**
   * Whether a value is valid under its declared scheme.
   *
   * Callers are expected to run this where the version is *declared* - at the build that emitted it.
   * That is the cheapest place in the system to catch a mismatch; carrying an invalid version and
   * discovering it at comparison time means a wrong answer has already reached a reader.
   */
  isValid(scheme: MeshVersionScheme, value: string | null | undefined): boolean {
    switch (scheme) {
      case MeshVersionScheme.integer:
        return value != null && integerPattern.test(value);
      case MeshVersionScheme.semver:
        return value != null && semverPattern.test(value);
      case MeshVersionScheme.lexicographic:
        // An empty serviceVersion is §2.4 case 3 - no declared version at all - rather than a version
        // that happens to be blank, so it is not valid under any scheme.
        return value != null && value.length > 0;
      default:
        return false;
    }
  },

  /**
   * Compares two service versions **of the same service**, in their wire form.
   *
   * This is the entry point a caller holding descriptor data actually wants, and it is where §2.5's
   * "there is no default scheme" rule is enforced: an absent or unrecognised `versionScheme` yields
   * {@link MeshVersionOrdering.notOrderable} rather than a fallback comparison. A silent fallback here
   * would be indistinguishable from a correct answer.
   */
  compareWire(
    leftScheme: string | null | undefined,
    leftValue: string | null | undefined,
    rightScheme: string | null | undefined,
    rightValue: string | null | undefined,
  ): MeshVersionOrdering {
    const left = MeshVersionOrder.tryParseScheme(leftScheme);
    const right = MeshVersionOrder.tryParseScheme(rightScheme);
    if (left === undefined || right === undefined) {
      return MeshVersionOrdering.notOrderable;
    }
    return MeshVersionOrder.compare(
      { value: leftValue ?? '', scheme: left },
      { value: rightValue ?? '', scheme: right },
    );
  },

  /**
   * Compares two service versions **of the same service**: where `left` sits relative to `right`, or
   * {@link MeshVersionOrdering.notOrderable} when the two carry different schemes or either is invalid
   * under its own.
   */
  compare(left: MeshServiceVersion, right: MeshServiceVersion): MeshVersionOrdering {
    if (left.scheme !== right.scheme) {
      // Different schemes are not orderable even when both values would parse under either one.
      // Agreeing by accident on a single pair of values is not an order.
      return MeshVersionOrdering.notOrderable;
    }

    if (!MeshVersionOrder.isValid(left.scheme, left.value) || !MeshVersionOrder.isValid(right.scheme, right.value)) {
      return MeshVersionOrdering.notOrderable;
    }

    let sign: number;
    switch (left.scheme) {
      case MeshVersionScheme.integer:
        sign = compareIntegers(left.value, right.value);
        break;
      case MeshVersionScheme.semver:
        sign = compareSemver(left.value, right.value);
        break;
      default:
        sign = ordinalSign(left.value, right.value);
        break;
    }

    return sign < 0 ? MeshVersionOrdering.earlier : sign > 0 ? MeshVersionOrdering.later : MeshVersionOrdering.same;
  },

  /**
   * Whether a version order and a build-time order **disagree** - a later version built earlier.
   *
   * Surfacing this is the point (mesh.md §2.5). It means an out-of-order pipeline, a rebuilt artifact
   * or a backdated tag, each of which is worth knowing, and none of which should be quietly reconciled
   * by preferring one field over the other. `createdAtUtc` values are epoch milliseconds.
   */
  disagreesWithBuildTime(
    left: MeshServiceVersion,
    leftCreatedAt: number,
    right: MeshServiceVersion,
    rightCreatedAt: number,
  ): boolean {
    switch (MeshVersionOrder.compare(left, right)) {
      case MeshVersionOrdering.later:
        return leftCreatedAt < rightCreatedAt;
      case MeshVersionOrdering.earlier:
        return leftCreatedAt > rightCreatedAt;
      default:
        return false;
    }
  },

  /**
   * The latest of a service's versions, or `undefined` when they cannot all be placed in one order.
   *
   * `undefined` rather than a best guess: "the newest version of this service" is the basis of a tip
   * composition and of every "N versions behind" statement, and answering it from a set that contains
   * a scheme discontinuity would put an unfounded number in front of a reader.
   */
  latest(versions: Iterable<MeshServiceVersion>): MeshServiceVersion | undefined {
    let latest: MeshServiceVersion | undefined;
    for (const version of versions) {
      if (latest === undefined) {
        if (!MeshVersionOrder.isValid(version.scheme, version.value)) {
          return undefined;
        }
        latest = version;
        continue;
      }

      const order = MeshVersionOrder.compare(version, latest);
      if (order === MeshVersionOrdering.notOrderable) {
        return undefined;
      }
      if (order === MeshVersionOrdering.later) {
        latest = version;
      }
    }
    return latest;
  },

  /**
   * How many versions separate `from` and `to` in `known` - the "four versions behind" figure.
   *
   * Returns a non-negative count, or `undefined` when the set cannot be ordered or either endpoint is
   * not in it. `undefined` is a real answer and must not be rendered as zero.
   */
  distance(
    from: MeshServiceVersion,
    to: MeshServiceVersion,
    known: Iterable<MeshServiceVersion>,
  ): number | undefined {
    const ordered: MeshServiceVersion[] = [];
    for (const version of known) {
      if (!MeshVersionOrder.isValid(version.scheme, version.value)) {
        return undefined;
      }
      if (ordered.length > 0 && MeshVersionOrder.compare(version, ordered[0]) === MeshVersionOrdering.notOrderable) {
        return undefined;
      }
      ordered.push(version);
    }

    ordered.sort((a, b) => {
      switch (MeshVersionOrder.compare(a, b)) {
        case MeshVersionOrdering.earlier:
          return -1;
        case MeshVersionOrdering.later:
          return 1;
        default:
          return 0;
      }
    });

    const fromIndex = ordered.findIndex((v) => MeshVersionOrder.compare(v, from) === MeshVersionOrdering.same);
    const toIndex = ordered.findIndex((v) => MeshVersionOrder.compare(v, to) === MeshVersionOrdering.same);
    if (fromIndex < 0 || toIndex < 0) {
      return undefined;
    }
    return Math.abs(toIndex - fromIndex);
  },

  /** Formats a version for display, scheme included, so a reader can see which order applies. */
  describe(version: MeshServiceVersion): string {
    return `${version.value} (${MeshVersionOrder.schemeName(version.scheme)})`;
  },
};

/**
 * Compares two all-digit strings by numeric value, at arbitrary precision.
 *
 * Done on the digits rather than through a fixed-width integer on purpose. Build counters do not
 * outrun 64 bits in any real pipeline, but a comparator that silently overflows is worse than one
 * that refuses, and this way the behaviour does not depend on the port's integer width. (JS `number`
 * loses integer precision past 2^53, so this is not merely theoretical here.)
 */
function compareIntegers(left: string, right: string): number {
  const l = left.replace(/^0+/, '');
  const r = right.replace(/^0+/, '');
  if (l.length !== r.length) {
    return l.length < r.length ? -1 : 1;
  }
  return ordinalSign(l, r);
}

/** SemVer 2.0.0 §11 precedence. Build metadata is ignored (§10). */
function compareSemver(left: string, right: string): number {
  // Both already validated by isValid, so the groups are present.
  const l = semverPattern.exec(left)!.groups!;
  const r = semverPattern.exec(right)!.groups!;

  for (const part of ['major', 'minor', 'patch']) {
    const comparison = compareIntegers(l[part], r[part]);
    if (comparison !== 0) {
      return comparison;
    }
  }

  const leftPre = l['prerelease'];
  const rightPre = r['prerelease'];
  if (leftPre === undefined && rightPre === undefined) {
    return 0;
  }

  // A pre-release has lower precedence than the normal version it precedes (§11.3).
  if (leftPre === undefined) {
    return 1;
  }
  if (rightPre === undefined) {
    return -1;
  }

  return comparePrerelease(leftPre.split('.'), rightPre.split('.'));
}

/** SemVer 2.0.0 §11.4: identifiers left to right, numeric below alphanumeric. */
function comparePrerelease(left: string[], right: string[]): number {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const leftNumeric = integerPattern.test(left[i]);
    const rightNumeric = integerPattern.test(right[i]);

    let comparison: number;
    if (leftNumeric && rightNumeric) {
      // Numerically, so rc.10 is later than rc.9 - the same digits-versus-string trap the whole of
      // §2.5 exists for, one level down.
      comparison = compareIntegers(left[i], right[i]);
    } else if (leftNumeric !== rightNumeric) {
      // Numeric identifiers always have lower precedence than alphanumeric ones.
      comparison = leftNumeric ? -1 : 1;
    } else {
      comparison = ordinalSign(left[i], right[i]);
    }

    if (comparison !== 0) {
      return comparison;
    }
  }

  // All the identifiers they share are equal, so the longer set wins (§11.4.4).
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

/** The sign of an ordinal (code-unit) string comparison - C# `string.CompareOrdinal`, normalized. */
function ordinalSign(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
