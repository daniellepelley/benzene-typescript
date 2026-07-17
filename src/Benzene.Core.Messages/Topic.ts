import { ITopic } from '@benzene/abstractions-messages';

/**
 * Port of Benzene.Core.Messages.Topic.
 */
export class Topic implements ITopic {
  readonly id: string;
  readonly version: string;

  constructor(id: string | undefined | null, version?: string | null) {
    this.id = id ?? '<missing>';
    this.version = version ?? '';
  }
}
