import { IApplicationInfo } from '@benzene/abstractions-message-handlers';

/**
 * Default IApplicationInfo implementation, populated via `SetApplicationInfo` with the
 * values the application supplies at startup.
 * Port of Benzene.Core.MessageHandlers.Info.ApplicationInfo.
 */
export class ApplicationInfo implements IApplicationInfo {
  readonly name: string;
  readonly version: string;
  readonly description: string;

  constructor(name: string, version: string, description: string) {
    this.name = name;
    this.version = version;
    this.description = description;
  }
}
