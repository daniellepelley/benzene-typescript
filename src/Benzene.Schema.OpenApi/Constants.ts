/** Port of Benzene.Schema.OpenApi.Constants. */
import { BenzeneTopic } from '@benzenejs/abstractions';
export const Constants = {
  /** The reserved topic the spec document is served on. */
  DefaultSpecTopic: BenzeneTopic.spec,
} as const;
