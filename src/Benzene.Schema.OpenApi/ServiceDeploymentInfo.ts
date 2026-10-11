/**
 * The deployment-side fields of the Contract Document (contract-document.md §1): where the service runs and how
 * it assesses itself. They sit outside both hashes (§6.2), so identity and placement never change them.
 */
import { IBenzeneServiceContainer, ServiceToken, serviceToken } from '@benzenejs/abstractions';

/** The `runtime` this port stamps on every Contract Document it produces (contract-document.md §1). */
export const ContractDocumentRuntime = 'typescript';

/**
 * Where the service runs (contract-document.md §1 `placement`). `cloud` is `aws`, `azure`, `gcp`, `self-hosted`
 * or an explicit override; `region` only where the platform documents a way to know it - never guessed.
 */
export interface ServicePlacement {
  readonly cloud: string;
  readonly region?: string;
}

/**
 * A conformance-profile self-assessment (contract-document.md §1 `profile`): `name` (`cloud-service` for the
 * Cloud Service Profile) and `missing`, the requirement ids the wiring knows it does not meet, omitted when none.
 */
export interface ServiceProfile {
  readonly name: string;
  readonly missing?: readonly string[];
}

/**
 * The deployment-side facts a service knows about itself, stamped onto its Contract Document by the
 * `SpecBuilder` - so the document `benzene:spec` serves and the one a mesh-enabled service registers are the
 * same document (mesh.md §2). Every member is optional; `runtime` defaults to {@link ContractDocumentRuntime}.
 *
 * Registered by `useBenzeneCloudService`; a host without the cloud-service builder registers one with
 * {@link setServiceDeploymentInfo}. Not a port of a .NET type (its 3b shape was not yet settled when this was
 * written): the TypeScript sibling of `IApplicationInfo`, kept next to the document builder that reads it.
 */
export interface IServiceDeploymentInfo {
  readonly runtime?: string;
  readonly placement?: ServicePlacement;
  readonly profile?: ServiceProfile;
}

export const IServiceDeploymentInfo: ServiceToken<IServiceDeploymentInfo> =
  serviceToken<IServiceDeploymentInfo>('IServiceDeploymentInfo');

/** Registers the service's deployment-side facts for its Contract Document (the `setApplicationInfo` sibling). */
export function setServiceDeploymentInfo(
  services: IBenzeneServiceContainer,
  info: IServiceDeploymentInfo,
): IBenzeneServiceContainer {
  services.addSingletonInstance(IServiceDeploymentInfo, info);
  return services;
}
