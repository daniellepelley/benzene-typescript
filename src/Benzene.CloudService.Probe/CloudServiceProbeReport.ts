/** Port of Benzene.CloudService.Probe.CloudServiceProbeReport (verdict enum + requirement + report). */

/**
 * The three verdicts an external, black-box probe can honestly reach for one requirement of the Cloud
 * Service Profile. A probe run from outside the service genuinely cannot always tell "yes" from "no" -
 * some requirements (R8 in full, half of R6) are not observable over HTTP from a single service at all.
 * `Inconclusive` exists so the probe can say "I don't know, and here is exactly why" instead of guessing.
 */
export enum CloudServiceProbeVerdict {
  /** The probe independently observed evidence that the requirement holds. */
  Satisfied,

  /** The probe reached the service and observed evidence that the requirement does not hold. */
  NotSatisfied,

  /** The probe cannot determine this requirement from outside the service alone. Never treat as a pass. */
  Inconclusive,
}

/** One profile requirement as independently assessed by an external `CloudServiceProbe` run. */
export class CloudServiceProbeRequirement {
  constructor(
    /** The requirement id (R1-R8). */
    readonly id: string,
    /** What the requirement mandates, in one line. */
    readonly description: string,
    /** The probe's independently-observed verdict for this requirement. */
    readonly verdict: CloudServiceProbeVerdict,
    /** Why the verdict is what it is - always populated. */
    readonly reason: string,
  ) {}
}

/**
 * The result of one `CloudServiceProbe` run against a live service: an external, black-box, tri-state
 * assessment of R1-R8 built entirely from what the probe itself observed over real HTTP - it never trusts
 * anything the target service claims about itself.
 */
export class CloudServiceProbeReport {
  constructor(
    /** Every profile requirement with its independently-observed assessment, in R1-R8 order. */
    readonly requirements: readonly CloudServiceProbeRequirement[],
  ) {}

  /** The ids the probe positively observed as unmet. */
  get notSatisfied(): string[] {
    return this.requirements
      .filter((x) => x.verdict === CloudServiceProbeVerdict.NotSatisfied)
      .map((x) => x.id);
  }

  /** The ids the probe could not determine from outside the service. */
  get inconclusive(): string[] {
    return this.requirements
      .filter((x) => x.verdict === CloudServiceProbeVerdict.Inconclusive)
      .map((x) => x.id);
  }

  /**
   * True when every requirement was independently observed as `Satisfied`. Given R8 (and half of R6) are
   * structurally unobservable by a single-service probe, this will essentially never be true for a real
   * service - that's the honest ceiling of what an external HTTP probe can claim.
   */
  get isFullyConformant(): boolean {
    return this.requirements.every((x) => x.verdict === CloudServiceProbeVerdict.Satisfied);
  }
}
