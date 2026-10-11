/** Port of Benzene.CloudService.CloudServiceProfileReport (and CloudServiceRequirement). */
import { ServiceProfile } from '@benzenejs/schema-openapi';
import type { CloudServiceBuilder } from './CloudServiceBuilder';

/**
 * One self-assessed requirement: a Cloud Service Profile requirement (cloud-service-profile.md §2, R1–R5 and
 * R7) or a meshed-service requirement (mesh.md §7.1, M1 and M2), as wired.
 */
export class CloudServiceRequirement {
  constructor(
    /** The requirement id: R1–R5 or R7 for the profile, M1 or M2 for the meshed-service claim. */
    readonly id: string,
    /** What the requirement mandates, in one line. */
    readonly description: string,
    /** Whether this service's wiring satisfies the requirement. */
    readonly satisfied: boolean,
    /** Why the requirement is (or isn't) satisfied, when that needs saying. */
    readonly note?: string,
  ) {}
}

/**
 * The wiring-time self-assessment of a service against the meshed-service claim (mesh.md §7.1): a Cloud
 * Service (the profile, R1–R5 and R7) plus M1 (registration, heartbeats and traces) and M2 (W3C trace context
 * joined inbound and forwarded on every outbound message). M1 and M2 were the profile's R6 and R8; they are
 * reported here, never in the profile's `missing`.
 */
export class MeshedServiceReport {
  constructor(
    /** M1 and M2 with their assessment, in that order. */
    readonly requirements: readonly CloudServiceRequirement[],
    /** Whether the service claims the Cloud Service Profile - the meshed claim's prerequisite. */
    readonly profileConformant: boolean,
  ) {}

  /** The ids (M1, M2) this service's wiring does not satisfy; empty when both are met. */
  get missing(): string[] {
    return this.requirements.filter((x) => !x.satisfied).map((x) => x.id);
  }

  /** True when the service is a Cloud Service and M1 and M2 are both met: it claims to be meshed. */
  get isMeshed(): boolean {
    return this.profileConformant && this.requirements.every((x) => x.satisfied);
  }
}

/**
 * The wiring-time self-assessment of a service against the Cloud Service Profile
 * (docs/specification/cloud-service-profile.md): R1–R5 and R7, the surfaces any tool can pull from the service
 * with no collector. Produced by `useBenzeneCloudService` from what was actually wired — defaults kept,
 * surfaces declined, paths relocated — and carried on the service's Contract Document (contract-document.md §1's
 * `profile` field) so any tool that can reach the reserved `benzene:spec` topic can ask a running service
 * whether it claims the profile. The meshed-service claim (mesh.md §7.1, M1 and M2) is assessed separately, on
 * {@link mesh}, and never appears in `missing`.
 *
 * This is a self-assessment of provisioning, not a runtime probe: it reflects what the builder wired, and
 * runtime degradation (an unreachable collector, a failing check) never changes it — per the profile's §4,
 * runtime degradation is not a conformance failure.
 */
export class CloudServiceProfileReport {
  /** The profile name carried on the wire (contract-document.md §1 `profile.name`). */
  static readonly profileName = 'cloud-service';

  // Public (not C#'s private) so the report can be registered as its own class token in DI, as the C#
  // wiring does (`AddSingleton(_ => report)`); `evaluate` remains the intended way to produce one.
  constructor(
    /** Every profile requirement with its assessment: R1–R5 and R7, in that order. */
    readonly requirements: readonly CloudServiceRequirement[],
    /** The meshed-service claim (mesh.md §7.1): M1 and M2, assessed separately from the profile. */
    readonly mesh: MeshedServiceReport = new MeshedServiceReport([], requirements.every((x) => x.satisfied)),
  ) {}

  /** The ids of the profile requirements (R1–R5, R7) this service's wiring does not satisfy; empty when conformant. */
  get missing(): string[] {
    return this.requirements.filter((x) => !x.satisfied).map((x) => x.id);
  }

  /** True when every profile requirement is satisfied — the service claims the profile. */
  get isConformant(): boolean {
    return this.requirements.every((x) => x.satisfied);
  }

  /** True when the service claims the profile and M1 and M2 are met — the meshed-service claim (mesh.md §7.1). */
  get isMeshed(): boolean {
    return this.mesh.isMeshed;
  }

  /** The wire shape for the Contract Document's `profile` field (contract-document.md §1): R1–R5/R7 ids only. */
  toProfile(): ServiceProfile {
    const missing = this.missing;
    return missing.length === 0
      ? { name: CloudServiceProfileReport.profileName }
      : { name: CloudServiceProfileReport.profileName, missing };
  }

  static evaluate(builder: CloudServiceBuilder): CloudServiceProfileReport {
    const mesh = builder.meshEnabled;
    const collector = builder.collectorEnvelopeUrl !== undefined;
    // The same condition `useBenzeneCloudService` wires the trace middleware under.
    const tracing = mesh && (collector || builder.traceExporter !== undefined);

    const requirements = [
      new CloudServiceRequirement(
        'R1',
        'Hosted middleware pipeline',
        true,
        'wired by useBenzeneCloudService on a hosted HTTP pipeline',
      ),
      new CloudServiceRequirement(
        'R2',
        'Message handlers via the registry',
        true,
        builder.handlerTypes !== undefined
          ? `${builder.handlerTypes.length} handler type(s) registered explicitly`
          : "handlers taken from the container's registrations; the Contract Document's requests are the runtime truth",
      ),
      new CloudServiceRequirement(
        'R3',
        'Health checks (reserved topic + HTTP surface)',
        true,
        builder.healthChecks.length === 0 ? 'no checks added; the aggregate reports healthy' : undefined,
      ),
      new CloudServiceRequirement('R4', 'Wire-envelope invocability', true),
      // R5: the derived Contract Document, answered on the reserved benzene:spec topic wherever the transport
      // carries a reply (here the HTTP pipeline and the wire envelope, both always wired), and at the spec path.
      new CloudServiceRequirement(
        'R5',
        'Derived spec (benzene:spec wherever a reply is carried + HTTP surface)',
        true,
        'benzene:spec answered on the HTTP and envelope surfaces, and served at the spec path',
      ),
      new CloudServiceRequirement(
        'R7',
        'Default service standard paths',
        builder.usesDefaultPaths,
        builder.usesDefaultPaths
          ? undefined
          : 'one or more surfaces relocated from their /benzene/ defaults; fleet tooling assumes the defaults',
      ),
    ];

    const meshRequirements = [
      // M1 (formerly R6): the three feeds - registration (the R5 document), heartbeats and traces - which need a
      // collector to go to.
      new CloudServiceRequirement(
        'M1',
        'Mesh service-side feeds (registration, heartbeats, traces)',
        mesh && collector,
        !mesh
          ? 'mesh declined via withoutMesh(): no registration, heartbeat or trace feed'
          : !collector
            ? 'no collector configured: the registration/heartbeat/trace feeds have no destination'
            : 'the contract document registered, heartbeats and traces sent to the configured collector',
      ),
      // M2 (formerly R8): the trace middleware joins inbound traceparent, and is wired only when there is an
      // exporter for its traces (a collector, or one supplied with withTraceExporter). Forwarding belongs to the
      // outbound routes (useMeshTraceContext), which the cloud service does not own and cannot see.
      new CloudServiceRequirement(
        'M2',
        'Trace context join and propagation (sends and published events)',
        tracing,
        !mesh
          ? 'mesh declined via withoutMesh(): the trace middleware that joins traceparent is not wired'
          : !tracing
            ? 'no collector or trace exporter configured: the trace middleware that joins traceparent is not wired'
            : 'inbound traceparent joined; forwarding on sends and published events needs useMeshTraceContext ' +
              '(@benzenejs/mesh-wire) on each outbound route, or the header set by hand on a raw client call',
      ),
    ];

    return new CloudServiceProfileReport(
      requirements,
      new MeshedServiceReport(meshRequirements, requirements.every((x) => x.satisfied)),
    );
  }
}
