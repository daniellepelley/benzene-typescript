import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Port of Benzene.Clients.IClientHeaders.
 *
 * A mutable bag of headers applied to every outbound send by `HeadersBenzeneMessageClient`.
 * C# `IDictionary<string, string>` maps to `Record<string, string>`.
 */
export interface IClientHeaders {
  /** Port of C# `void Set(string key, string value)`. */
  set(key: string, value: string): void;

  /** Port of C# `IDictionary<string, string> Get()`. */
  get(): Record<string, string>;
}

export const IClientHeaders: ServiceToken<IClientHeaders> =
  serviceToken<IClientHeaders>('IClientHeaders');
