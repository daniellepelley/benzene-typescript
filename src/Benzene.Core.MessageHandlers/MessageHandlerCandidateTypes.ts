import { Constructor } from '@benzene/abstractions';

/**
 * Records one `addMessageHandlers(...)` call's explicit handler types (or no types, for the
 * "discover from the global registry" case), registered additively so the container-wide
 * `IMessageHandlersFinder` singleton can be built at resolution time over the deduped union of
 * every call's candidates - not just the first call's.
 * Port of Benzene.Core.MessageHandlers.MessageHandlerCandidateTypes (C#'s equivalent record, used
 * for the same purpose plus cross-cutting diagnostics like `UnroutedHttpEndpointCheck`).
 *
 * Before this existed, `addMessageHandlers` built its `RegistryMessageHandlersFinder` from a single
 * call's own handler types and registered it as the `IMessageHandlersFinder` singleton via
 * `tryAddSingletonFactory` - a *second* call on the same container (e.g. `useMessageHandlers` on two
 * different in-process pipelines sharing one container, each with its own explicit handler class)
 * had its finder silently discarded: `tryAdd` means only the first call's finder ever won, and the
 * second call's handlers became unroutable with no error anywhere. See `addMessageHandlers`' own
 * comment for the fix.
 */
export class MessageHandlerCandidateTypes {
  constructor(readonly types: readonly Constructor<unknown>[]) {}
}
