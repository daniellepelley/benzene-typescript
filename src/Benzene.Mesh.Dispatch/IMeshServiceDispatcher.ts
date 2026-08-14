/** Port of Benzene.Mesh.Dispatch.IMeshServiceDispatcher. */
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { MeshServiceRegistryEntry } from '@benzenejs/mesh-contracts';
import { MeshDispatchEnvelope, MeshDispatchResult } from './MeshDispatchEnvelope';

/**
 * Dispatches a message to ONE target service over a specific transport - the write-side counterpart of the
 * aggregator's read-only service source. Keyed by `MeshServiceRegistryEntry.source` so the handler picks
 * the right transport per service. `CancellationToken` -> optional `AbortSignal`.
 */
export interface IMeshServiceDispatcher {
  /** The `MeshServiceRegistryEntry.source` value this dispatcher handles. */
  readonly key: string;

  /** Sends `envelope` to the service described by `entry` and returns its response. */
  dispatchAsync(
    entry: MeshServiceRegistryEntry,
    envelope: MeshDispatchEnvelope,
    cancellationToken?: AbortSignal,
  ): Promise<MeshDispatchResult>;
}

/** Container token: dispatchers are registered and collected via `getServices(IMeshServiceDispatcher)`. */
export const IMeshServiceDispatcher: ServiceToken<IMeshServiceDispatcher> =
  serviceToken<IMeshServiceDispatcher>('IMeshServiceDispatcher');
