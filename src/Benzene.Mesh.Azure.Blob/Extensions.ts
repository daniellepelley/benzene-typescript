/** Port of Benzene.Mesh.Azure.Blob.Extensions. */
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { addMeshAggregator } from '@benzenejs/mesh-aggregator';
import { MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { BlobMeshArtifactStore } from './BlobMeshArtifactStore';

/**
 * Registers the mesh aggregator backed by a `BlobMeshArtifactStore`, so catalog artifacts and the
 * discovered registry live in Azure Blob Storage. C#'s two overloads (an explicit `ContainerClient`, or a
 * blob-service URI + container name authenticated with `DefaultAzureCredential`) become one overloaded free
 * function: pass a `ContainerClient`, or a `blobServiceUri` string plus `containerName`.
 *
 * @param services The service container.
 * @param registry The initial registry (usually empty - discovery replaces it at runtime).
 */
export function addMeshAggregatorWithBlob(
  services: IBenzeneServiceContainer,
  registry: MeshServiceRegistry,
  container: ContainerClient,
  prefix?: string,
): IBenzeneServiceContainer;
export function addMeshAggregatorWithBlob(
  services: IBenzeneServiceContainer,
  registry: MeshServiceRegistry,
  blobServiceUri: string,
  containerName: string,
  prefix?: string,
): IBenzeneServiceContainer;
export function addMeshAggregatorWithBlob(
  services: IBenzeneServiceContainer,
  registry: MeshServiceRegistry,
  containerOrUri: ContainerClient | string,
  containerNameOrPrefix?: string,
  prefix?: string,
): IBenzeneServiceContainer {
  if (typeof containerOrUri === 'string') {
    // DefaultAzureCredential: managed identity in Azure, the dev credential locally.
    const container = new BlobServiceClient(containerOrUri, new DefaultAzureCredential()).getContainerClient(containerNameOrPrefix ?? '');
    return addMeshAggregator(services, registry, () => new BlobMeshArtifactStore(container, prefix ?? ''));
  }

  return addMeshAggregator(services, registry, () => new BlobMeshArtifactStore(containerOrUri, containerNameOrPrefix ?? ''));
}
