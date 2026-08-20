/** Port of Benzene.Schema.OpenApi.ReservedTopics. */
import { BenzeneTopic } from '@benzenejs/abstractions';

/**
 * The reserved "utility" topics of the Benzene Cloud Service Profile — operational surfaces (spec, health,
 * mesh descriptor, mesh feeds) every conformant service exposes but which are not part of its business
 * domain. Spec/mesh tooling uses this to separate them from domain topics.
 *
 * Matched by the `benzene:` prefix rule of {@link BenzeneTopic.isReserved}, not by a name list: every
 * framework-owned id carries the marker (cloud-service-profile.md R3/R6, mesh.md §1), so the prefix
 * answers "is this Benzene's?" by inspection and keeps recognising mesh and future framework topics
 * without anyone remembering to extend a list. A reserved topic deliberately renamed to an
 * application-namespaced alias won't be auto-classified — the split is a presentation aid, not a
 * security boundary.
 */
export const ReservedTopics = {
  /** Whether `topic` is one of the reserved utility topics. */
  isReserved(topic: string | undefined): boolean {
    return BenzeneTopic.isReserved(topic);
  },
} as const;
