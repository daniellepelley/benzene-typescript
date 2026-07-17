import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Write side of the current-transport pairing with ICurrentTransport. A transport
 * adapter calls setTransport once it starts handling a message, so ICurrentTransport
 * can later report which transport is active for the invocation.
 * Port of Benzene.Abstractions.MessageHandlers.Info.ISetCurrentTransport.
 */
export interface ISetCurrentTransport {
  /**
   * Records the name of the transport currently handling a message.
   * @param transport The transport name (e.g. matching an ITransportInfo entry).
   */
  setTransport(transport: string): void;
}

export const ISetCurrentTransport: ServiceToken<ISetCurrentTransport> =
  serviceToken<ISetCurrentTransport>('ISetCurrentTransport');
