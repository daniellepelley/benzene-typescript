import { ICurrentTransport, ISetCurrentTransport } from '@benzene/abstractions-message-handlers';
import { Constants } from '../Constants';

/**
 * Default ICurrentTransport/ISetCurrentTransport implementation, registered scoped so each
 * invocation gets its own current-transport value. Starts out set to Constants.missing's id
 * until a transport pipeline (e.g. via TransportMiddlewarePipeline) records itself.
 * Port of Benzene.Core.MessageHandlers.Info.CurrentTransportInfo.
 */
export class CurrentTransportInfo implements ICurrentTransport, ISetCurrentTransport {
  #name: string = Constants.missing.id;

  get name(): string {
    return this.#name;
  }

  setTransport(transport: string): void {
    this.#name = transport;
  }
}
