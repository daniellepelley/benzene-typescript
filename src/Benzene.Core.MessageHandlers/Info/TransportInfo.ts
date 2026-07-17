import { ITransportInfo } from '@benzene/abstractions-message-handlers';

/**
 * Default ITransportInfo implementation. Typically registered once per transport adapter
 * (e.g. `new TransportInfo("direct")` for the BenzeneMessage transport), and aggregated by
 * TransportsInfo.
 * Port of Benzene.Core.MessageHandlers.Info.TransportInfo.
 */
export class TransportInfo implements ITransportInfo {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
}
