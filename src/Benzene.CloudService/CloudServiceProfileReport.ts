/** Port of Benzene.CloudService.CloudServiceProfileReport (and CloudServiceRequirement). */
import { ServiceProfile } from '@benzenejs/schema-openapi';
import type { CloudServiceBuilder } from './CloudServiceBuilder';

/** One requirement of the Cloud Service Profile (docs/specification/cloud-service-profile.md §2), as self-assessed at wire-up. */
export class CloudServiceRequirement {
  constructor(
    /** The requirement id (R1–R8). */
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
 * The wiring-time self-assessment of a service against the Cloud Service Profile
 * (docs/specification/cloud-service-profile.md). Produced by `useBenzeneCloudService` from what was
 * actually wired — defaults kept, surfaces declined, paths relocated — and carried on the service's Contract
 * Document (contract-document.md §1's `profile` field) so any tool that can reach the reserved `benzene:spec`
 * topic (or a collector it registered with) can ask a running service whether it claims the profile.
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
    /** Every profile requirement with its assessment, in R1–R8 order. */
    readonly requirements: readonly CloudServiceRequirement[],
  ) {}

  /** The ids of the requirements this service's wiring does not satisfy; empty when conformant. */
  get missing(): string[] {
    return this.requirements.filter((x) => !x.satisfied).map((x) => x.id);
  }

  /** True when every requirement is satisfied — the service claims the profile. */
  get isConformant(): boolean {
    return this.requirements.every((x) => x.satisfied);
  }

  /** The wire shape for the Contract Document's `profile` field (contract-document.md §1). */
  toProfile(): ServiceProfile {
    const missing = this.missing;
    return missing.length === 0
      ? { name: CloudServiceProfileReport.profileName }
      : { name: CloudServiceProfileReport.profileName, missing };
  }

  static evaluate(builder: CloudServiceBuilder): CloudServiceProfileReport {
    const mesh = builder.meshEnabled;
    const collector = builder.collectorEnvelopeUrl !== undefined;

    return new CloudServiceProfileReport([
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
      new CloudServiceRequirement('R5', 'Derived spec', true),
      // R6 (spec 3b): benzene:spec answered on every transport (always wired here), plus three feeds - the
      // registration (the R5 document), heartbeats and traces - which need a collector to go to.
      new CloudServiceRequirement(
        'R6',
        'Mesh service-side feeds (benzene:spec, registration, heartbeats, traces)',
        mesh && collector,
        !mesh
          ? 'mesh declined via withoutMesh(): benzene:spec is still served, but no registration, heartbeat or trace feed'
          : !collector
            ? 'no collector configured: benzene:spec is served, but the registration/heartbeat/trace feeds have no destination'
            : 'benzene:spec served on the HTTP and envelope surfaces; the R5 document registered, heartbeats and traces sent',
      ),
      new CloudServiceRequirement(
        'R7',
        'Default service standard paths',
        builder.usesDefaultPaths,
        builder.usesDefaultPaths
          ? undefined
          : 'one or more surfaces relocated from their /benzene/ defaults; fleet tooling assumes the defaults',
      ),
      new CloudServiceRequirement(
        'R8',
        'Trace context join and propagation',
        mesh,
        mesh ? undefined : 'mesh declined via withoutMesh(): the trace middleware that joins traceparent is not wired',
      ),
    ]);
  }
}
