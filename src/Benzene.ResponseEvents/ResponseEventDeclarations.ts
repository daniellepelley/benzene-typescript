import { IMessageDefinition } from '@benzene/abstractions-messages';

/**
 * A set of declaration-only published-event definitions - events this service sends (typically directly
 * via an outbound sender from handler code) that should appear in generated specs and the
 * {@link IResponseEventCatalog} without any runtime republishing behavior. Registered via
 * {@link addResponseEventDeclarations}; aggregated by {@link ResponseEventCatalog} alongside the mapped
 * response events.
 * Port of Benzene.ResponseEvents.ResponseEventDeclarations.
 */
export class ResponseEventDeclarations {
  /** The declared published-event definitions. */
  readonly definitions: readonly IMessageDefinition[];

  constructor(definitions: readonly IMessageDefinition[]) {
    this.definitions = definitions;
  }
}
