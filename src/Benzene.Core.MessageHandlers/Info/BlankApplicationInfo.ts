import { IApplicationInfo } from '@benzene/abstractions-message-handlers';

/**
 * Default fallback IApplicationInfo registered by `AddBenzene` so an IApplicationInfo is
 * always resolvable, even if the application never calls `SetApplicationInfo`. Every
 * property is an empty string.
 * Port of Benzene.Core.MessageHandlers.Info.BlankApplicationInfo.
 */
export class BlankApplicationInfo implements IApplicationInfo {
  get name(): string {
    return '';
  }

  get description(): string {
    return '';
  }

  get version(): string {
    return '';
  }
}
