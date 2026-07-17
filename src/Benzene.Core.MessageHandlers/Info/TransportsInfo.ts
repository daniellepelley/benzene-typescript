import { ITransportInfo, ITransportsInfo } from '@benzene/abstractions-message-handlers';

/**
 * Default ITransportsInfo implementation, aggregating the distinct names of every
 * ITransportInfo registered in DI (one per transport adapter in use).
 * Port of Benzene.Core.MessageHandlers.Info.TransportsInfo.
 *
 * The C# `IEnumerable<ITransportInfo>` constructor injection maps to a resolved array
 * (`resolver.getServices(ITransportInfo)`).
 */
export class TransportsInfo implements ITransportsInfo {
  readonly transports: string[];

  constructor(transportInfos: readonly ITransportInfo[]) {
    this.transports = [...new Set(transportInfos.map((x) => x.name))];
  }
}
