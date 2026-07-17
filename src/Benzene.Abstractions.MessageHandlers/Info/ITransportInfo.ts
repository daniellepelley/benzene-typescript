import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Describes a single transport the application can receive messages over
 * (e.g. "Http", "Kafka", "Sqs").
 * Port of Benzene.Abstractions.MessageHandlers.Info.ITransportInfo.
 */
export interface ITransportInfo {
  /** The transport's name. */
  readonly name: string;
}

export const ITransportInfo: ServiceToken<ITransportInfo> =
  serviceToken<ITransportInfo>('ITransportInfo');
