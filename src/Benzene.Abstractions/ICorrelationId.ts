import { ServiceToken, serviceToken } from './DI/ServiceToken';

/**
 * Tracks the correlation id for the current invocation.
 * Port of Benzene.Abstractions.ICorrelationId.
 */
export interface ICorrelationId {
  set(correlationId: string): void;

  get(): string;
}

export const ICorrelationId: ServiceToken<ICorrelationId> =
  serviceToken<ICorrelationId>('ICorrelationId');
