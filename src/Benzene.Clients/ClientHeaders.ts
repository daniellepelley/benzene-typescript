import { IClientHeaders } from './IClientHeaders';

/**
 * Port of Benzene.Clients.ClientHeaders.
 *
 * Default `IClientHeaders`: an in-memory key/value store. C# `Dictionary<string, string>` maps to a
 * plain `Record<string, string>`.
 */
export class ClientHeaders implements IClientHeaders {
  private readonly dictionary: Record<string, string> = {};

  set(key: string, value: string): void {
    this.dictionary[key] = value;
  }

  get(): Record<string, string> {
    return this.dictionary;
  }
}
