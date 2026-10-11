import { IVersionSelector } from '@benzenejs/abstractions-message-handlers';
import { highestOrdinal } from './VersionSelector';

/**
 * An **opt-in** {@link IVersionSelector}: the requested version when a handler is registered for it
 * exactly, otherwise the highest registered version (ordinal comparison) — including for a message that
 * carries no version. This was the default before spec-0.2.0; the spec now forbids it as a default
 * (core-concepts §2: a caller that named a version must never silently get another version's behaviour)
 * but permits it as an explicit, replaceable policy.
 *
 * Opt in by replacing the registration after `addBenzene`:
 * `services.addSingleton(IVersionSelector, HighestAvailableVersionSelector)`.
 *
 * TypeScript-only (the .NET port has no class of this name); it preserves the pre-0.2.0 behaviour for an
 * application that relies on it while it migrates to declared defaults.
 */
export class HighestAvailableVersionSelector implements IVersionSelector {
  select(requestedVersion: string, availableVersions: string[]): string | undefined {
    if (availableVersions.includes(requestedVersion ?? '')) {
      return requestedVersion ?? '';
    }

    return highestOrdinal(availableVersions);
  }
}
