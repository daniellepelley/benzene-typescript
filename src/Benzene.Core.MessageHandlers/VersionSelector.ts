import { IVersionSelector } from '@benzene/abstractions-message-handlers';

/**
 * Returns the requested version when available, otherwise the highest available
 * version (lexicographic, matching the C# `MaxBy` on strings).
 * Port of Benzene.Core.MessageHandlers.VersionSelector.
 */
export class VersionSelector implements IVersionSelector {
  select(requestedVersion: string, availableVersions: string[]): string {
    if (availableVersions.includes(requestedVersion)) {
      return requestedVersion;
    }

    return availableVersions.reduce((max, version) => (version > max ? version : max));
  }
}
