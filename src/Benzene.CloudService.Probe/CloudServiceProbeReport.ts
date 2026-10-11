/** Port of Benzene.CloudService.Probe.CloudServiceProbeReport (verdict enum + requirement + report). */

/**
 * The three verdicts an external, black-box probe can honestly reach for one requirement of the Cloud
 * Service Profile (or of the meshed-service claim). A probe run from outside the service genuinely cannot always
 * tell "yes" from "no" - the meshed-service requirements (M1, M2) are not observable over HTTP from a single
 * service at all.
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

/** One requirement (R1–R5, R7, or M1/M2) as independently assessed by an external `CloudServiceProbe` run. */
export class CloudServiceProbeRequirement {
  constructor(
    /** The requirement id: R1–R5 or R7 for the profile, M1 or M2 for the meshed-service claim. */
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
 * assessment of the Cloud Service Profile (R1–R5, R7) built entirely from what the probe itself observed over
 * real HTTP - it never trusts anything the target service claims about itself - plus, separately, what it can say
 * of the meshed-service claim (mesh.md §7.1, M1 and M2).
 */
export class CloudServiceProbeReport {
  constructor(
    /** Every profile requirement with its independently-observed assessment: R1–R5 and R7, in that order. */
    readonly requirements: readonly CloudServiceProbeRequirement[],
    /**
     * The meshed-service claim (mesh.md §7.1): M1 (registration, heartbeats, traces) and M2 (trace context
     * propagation). Neither is observable from outside one service, so both are `Inconclusive`; they never feed
     * {@link notSatisfied}, {@link inconclusive} or {@link isFullyConformant}, which are about the profile.
     */
    readonly mesh: readonly CloudServiceProbeRequirement[] = [],
  ) {}

  /** The profile ids (R1–R5, R7) the probe positively observed as unmet. */
  get notSatisfied(): string[] {
    return this.requirements
      .filter((x) => x.verdict === CloudServiceProbeVerdict.NotSatisfied)
      .map((x) => x.id);
  }

  /** The profile ids (R1–R5, R7) the probe could not determine from outside the service. */
  get inconclusive(): string[] {
    return this.requirements
      .filter((x) => x.verdict === CloudServiceProbeVerdict.Inconclusive)
      .map((x) => x.id);
  }

  /**
   * True when every profile requirement (R1–R5, R7) was independently observed as `Satisfied`. R2 is inferred
   * from the contract document's requests, so a service with no handlers yet stays `Inconclusive` there. Says
   * nothing about the meshed-service claim (see {@link mesh}).
   */
  get isFullyConformant(): boolean {
    return this.requirements.every((x) => x.verdict === CloudServiceProbeVerdict.Satisfied);
  }
}
