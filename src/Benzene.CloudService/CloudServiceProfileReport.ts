/** Port of Benzene.CloudService.CloudServiceProfileReport (and CloudServiceRequirement). */
import { MeshProfile } from '@benzenejs/mesh-wire';
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
 * actually wired — defaults kept, surfaces declined, paths relocated — and carried on the service's
 * descriptor (mesh.md §2's `profile` field) so any tool that can reach the reserved `mesh` topic can ask
 * a running service whether it claims the profile.
 *
 * This is a self-assessment of provisioning, not a runtime probe: it reflects what the builder wired, and
 * runtime degradation (an unreachable collector, a failing check) never changes it — per the profile's §4,
 * runtime degradation is not a conformance failure.
 */
export class CloudServiceProfileReport {
  /** The profile name carried on the wire (mesh.md §2 `profile.name`). */
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

  /** The wire shape for the descriptor's `profile` field. */
  toMeshProfile(): MeshProfile {
    const missing = this.missing;
    const profile = new MeshProfile();
    profile.name = CloudServiceProfileReport.profileName;
    profile.missing = missing.length === 0 ? undefined : missing;
    return profile;
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
          : "handlers taken from the container's registrations; the descriptor's topics are the runtime truth",
      ),
      new CloudServiceRequirement(
        'R3',
        'Health checks (reserved topic + HTTP surface)',
        true,
        builder.healthChecks.length === 0 ? 'no checks added; the aggregate reports healthy' : undefined,
      ),
      new CloudServiceRequirement('R4', 'Wire-envelope invocability', true),
      new CloudServiceRequirement('R5', 'Derived spec', true),
      new CloudServiceRequirement(
        'R6',
        'Mesh service-side feeds',
        mesh && collector,
        !mesh
          ? 'mesh declined via withoutMesh()'
          : !collector
            ? 'no collector configured: register/heartbeat/trace feeds have no destination'
            : undefined,
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
