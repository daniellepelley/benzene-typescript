/** Port of Benzene.Mesh.Contracts.IMeshReportPublisher. */
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { MeshServiceReport } from './MeshServiceReport';

/**
 * Publishes a self-reported `MeshServiceReport` somewhere it becomes part of the mesh catalog - a port, not
 * an implementation, so a reporting service depends on just this package (a deliberate small widening of
 * this package's role from "pure data shapes" to "data shapes + zero-I/O port interfaces").
 */
export interface IMeshReportPublisher {
  /** Publishes the given report. */
  publishAsync(report: MeshServiceReport): Promise<void>;
}

/** Container token: the aggregator resolves the configured publisher by this interface. */
export const IMeshReportPublisher: ServiceToken<IMeshReportPublisher> =
  serviceToken<IMeshReportPublisher>('IMeshReportPublisher');
