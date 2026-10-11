import { ServiceIdentifier, ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * Answers whether a registered payload cast takes a payload of one version to a handler's request type —
 * the "cast-reachable" step of version selection (core-concepts §2, versioning.md). Registered by
 * `usePayloadVersionCasting` (`@benzenejs/core-versioning`); when it is absent no handler is reachable by
 * cast and selection is exact-match only.
 *
 * TypeScript-only seam (no .NET file of this name): `MessageHandlerDefinitionLookUp` lives in
 * `@benzenejs/core-message-handlers`, which the versioning package depends on, so the lookup reaches the
 * casters through this abstraction rather than importing them. Reachability is keyed on the handler's
 * **request type**, because that is what the casting request mapper actually casts to — so an
 * unversioned handler is a cast target like any other.
 */
export interface IPayloadCastLookUp {
  /**
   * @param topic The topic id.
   * @param fromVersion The version the message carries.
   * @param toRequestType The candidate handler's declared request type.
   */
  canCast(topic: string, fromVersion: string, toRequestType: ServiceIdentifier<unknown>): boolean;
}

export const IPayloadCastLookUp: ServiceToken<IPayloadCastLookUp> =
  serviceToken<IPayloadCastLookUp>('IPayloadCastLookUp');
