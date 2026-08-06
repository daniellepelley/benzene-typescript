/** Port of Benzene.Mesh.GoogleCloud.Storage.Extensions. */
import { Storage } from '@google-cloud/storage';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { addMeshAggregator } from '@benzene/mesh-aggregator';
import { MeshServiceRegistry } from '@benzene/mesh-contracts';
import { GcsMeshArtifactStore } from './GcsMeshArtifactStore';

/**
 * Registers the mesh aggregator backed by a `GcsMeshArtifactStore`, so catalog artifacts and the discovered
 * registry live in Google Cloud Storage. Mirrors `addMeshAggregatorWithS3` / `addMeshAggregatorWithBlob`.
 * C#'s two overloads (an explicit `StorageClient`, or one built from Application Default Credentials) become
 * one overloaded free function: pass a `Storage` client, or omit it to build one from ADC (the attached
 * service account in Google Cloud, the dev credential locally).
 *
 * @param services The service container.
 * @param registry The initial registry (usually empty - discovery replaces it at runtime).
 */
export function addMeshAggregatorWithGcs(
  services: IBenzeneServiceContainer,
  registry: MeshServiceRegistry,
  storage: Storage,
  bucket: string,
  prefix?: string,
): IBenzeneServiceContainer;
export function addMeshAggregatorWithGcs(
  services: IBenzeneServiceContainer,
  registry: MeshServiceRegistry,
  bucket: string,
  prefix?: string,
): IBenzeneServiceContainer;
export function addMeshAggregatorWithGcs(
  services: IBenzeneServiceContainer,
  registry: MeshServiceRegistry,
  storageOrBucket: Storage | string,
  bucketOrPrefix?: string,
  prefix?: string,
): IBenzeneServiceContainer {
  if (typeof storageOrBucket === 'string') {
    // ADC form: build the client from Application Default Credentials. storageOrBucket is the bucket,
    // bucketOrPrefix the optional prefix.
    const store = new GcsMeshArtifactStore(new Storage(), storageOrBucket, bucketOrPrefix ?? '');
    return addMeshAggregator(services, registry, () => store);
  }

  // Explicit-client form: storageOrBucket is the Storage client, bucketOrPrefix the bucket.
  const store = new GcsMeshArtifactStore(storageOrBucket, bucketOrPrefix ?? '', prefix ?? '');
  return addMeshAggregator(services, registry, () => store);
}
