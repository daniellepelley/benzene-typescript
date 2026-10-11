import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * What a version selector knows about a topic beyond its registered versions (core-concepts §2).
 * Built per message by `MessageHandlerDefinitionLookUp`.
 */
export interface VersionSelectionOptions {
  /**
   * The version of the topic's **default handler** — `''` when an unversioned handler is registered,
   * otherwise the version of the handler the application declared default (`@message(topic,
   * { version, isDefault: true })`), otherwise `undefined` (the topic has no default handler).
   */
  readonly defaultVersion?: string;

  /**
   * The registered versions whose handler the requested version can be **cast** to — a registered
   * payload cast takes a payload of the requested version to that handler's request type
   * (`IPayloadCastLookUp`). Empty when no casting is wired. May contain `''` (an unversioned handler is
   * a cast target like any other).
   */
  readonly castableVersions?: readonly string[];
}

/**
 * Selects which handler version serves a requested message version.
 * Port of Benzene.Abstractions.MessageHandlers.IVersionSelector.
 *
 * The default implementation (`VersionSelector`) is the spec's selection rule (core-concepts §2): an
 * exact match; else a handler the version can be cast to; else nothing (`not-found`). A message with no
 * version goes to the topic's default handler. Replace the registration to choose a different policy —
 * `HighestAvailableVersionSelector` is the opt-in "exact, else the highest registered version" policy.
 *
 * DIVERGENCE (TypeScript): C# `string Select(string?, string[])` always returns one of the available
 * versions. Here `select` may return `undefined` ("no handler serves this version", which the router
 * answers `not-found`), and takes an optional third argument with the topic's default and cast-reachable
 * versions. An implementation written against the old two-argument shape still type-checks.
 */
export interface IVersionSelector {
  /**
   * @param requestedVersion The version the message carries, `''` when it carries none.
   * @param availableVersions The versions registered for the topic (`''` is the unversioned handler).
   * @param options The topic's default version and the versions `requestedVersion` can be cast to.
   * @returns One of `availableVersions`, or `undefined` when no handler serves the requested version.
   */
  select(
    requestedVersion: string,
    availableVersions: string[],
    options?: VersionSelectionOptions,
  ): string | undefined;
}

export const IVersionSelector: ServiceToken<IVersionSelector> =
  serviceToken<IVersionSelector>('IVersionSelector');
