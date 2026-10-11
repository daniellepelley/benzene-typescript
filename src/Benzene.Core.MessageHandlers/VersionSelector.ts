import { IVersionSelector, VersionSelectionOptions } from '@benzenejs/abstractions-message-handlers';

/**
 * The default {@link IVersionSelector}: the spec's version-selection rule (core-concepts §2).
 * Port of Benzene.Core.MessageHandlers.VersionSelector.
 *
 * For a message carrying version *v*:
 *  1. the handler registered for exactly *v*;
 *  2. otherwise a handler *v* can be **cast** to (`options.castableVersions`). When there are several, the
 *     topic's default handler wins if it is among them; otherwise the cast target with the ordinally
 *     **highest** version is chosen — deterministic, whatever the registration order (`''`, an
 *     unversioned target, sorts lowest);
 *  3. otherwise `undefined`, which the router answers `not-found` naming the topic and *v*.
 *
 * A message carrying **no** version goes to the topic's default handler (`options.defaultVersion`): the
 * unversioned handler, else the one declared default; with neither, `undefined` (`not-found`).
 *
 * There is no "highest available" fallback: serving another version's behaviour to a caller that named a
 * version is the failure versioning exists to prevent. `HighestAvailableVersionSelector` keeps that
 * policy as an explicit opt-in.
 */
export class VersionSelector implements IVersionSelector {
  select(
    requestedVersion: string,
    availableVersions: string[],
    options?: VersionSelectionOptions,
  ): string | undefined {
    if (requestedVersion === undefined || requestedVersion === null || requestedVersion === '') {
      return options?.defaultVersion;
    }

    if (availableVersions.includes(requestedVersion)) {
      return requestedVersion;
    }

    const castable = (options?.castableVersions ?? []).filter((v) => availableVersions.includes(v));
    if (castable.length === 0) {
      return undefined;
    }

    if (options?.defaultVersion !== undefined && castable.includes(options.defaultVersion)) {
      return options.defaultVersion;
    }

    return highestOrdinal(castable);
  }
}

/** The ordinal maximum (C# `StringComparer.Ordinal`), independent of locale. */
export function highestOrdinal(versions: readonly string[]): string | undefined {
  let max: string | undefined;
  for (const version of versions) {
    if (max === undefined || version > max) {
      max = version;
    }
  }
  return max;
}
