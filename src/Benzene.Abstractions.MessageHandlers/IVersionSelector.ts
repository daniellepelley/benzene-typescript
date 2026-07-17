import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Selects which handler version serves a requested message version.
 * Port of Benzene.Abstractions.MessageHandlers.IVersionSelector.
 */
export interface IVersionSelector {
  select(requestedVersion: string, availableVersions: string[]): string;
}

export const IVersionSelector: ServiceToken<IVersionSelector> =
  serviceToken<IVersionSelector>('IVersionSelector');
