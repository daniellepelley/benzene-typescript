/** Port of Benzene.Schema.OpenApi.ReservedTopics. */
import { Constants } from './Constants';

/**
 * The reserved "utility" topics of the Benzene Cloud Service Profile — operational surfaces (spec, health,
 * mesh descriptor, envelope, self-report) every conformant service exposes but which are not part of its
 * business domain. Spec/mesh tooling uses this to separate them from domain topics. Matched by topic id
 * against the profile's default ids (case-insensitively); a renamed reserved topic won't be auto-classified
 * — the split is a presentation aid, not a security boundary.
 */
const defaultIds = new Set<string>(
  [
    Constants.DefaultSpecTopic, // 'spec'
    'test-payloads',
    'healthcheck',
    'liveness',
    'readiness',
    'mesh', // cloud-service descriptor topic
    'invoke', // wire-envelope endpoint topic
    'report', // mesh self-report ingestion topic
  ].map((id) => id.toLowerCase()),
);

export const ReservedTopics = {
  /** Whether `topic` is one of the reserved utility topics. */
  isReserved(topic: string | undefined): boolean {
    return topic !== undefined && defaultIds.has(topic.toLowerCase());
  },
} as const;
