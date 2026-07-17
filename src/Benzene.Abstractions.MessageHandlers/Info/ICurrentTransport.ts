import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Read side of the current-transport pairing with ISetCurrentTransport: reports which
 * registered transport (see ITransportsInfo) is handling the message currently being
 * processed, so shared handler/middleware code can behave differently per transport
 * when needed.
 * Port of Benzene.Abstractions.MessageHandlers.Info.ICurrentTransport.
 */
export interface ICurrentTransport {
  /** The name of the transport currently handling the message. */
  readonly name: string;
}

export const ICurrentTransport: ServiceToken<ICurrentTransport> =
  serviceToken<ICurrentTransport>('ICurrentTransport');
