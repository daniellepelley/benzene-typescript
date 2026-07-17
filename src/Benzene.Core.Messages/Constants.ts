import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from './Topic';

/** Port of Benzene.Core.Messages.Constants. */
export const Constants = {
  get missing(): ITopic {
    return new Topic('<missing>');
  },
} as const;
