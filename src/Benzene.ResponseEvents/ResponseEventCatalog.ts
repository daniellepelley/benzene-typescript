import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageDefinition, IMessageDefinitionFinder, ITopic } from '@benzene/abstractions-messages';
import { IResponseEventMapping } from './IResponseEventMapping';
import { ResponseEventDeclarations } from './ResponseEventDeclarations';
import { ResponseEventDefinition } from './ResponseEventDefinition';
import { ResponseEventMappings } from './ResponseEventMappings';

/**
 * App-wide, queryable view of every response-event mapping registered by any pipeline's
 * `useResponseEvents(...)` call, plus any declaration-only published events - resolve it from DI to see
 * exactly what this service publishes, as plain data.
 * Port of Benzene.ResponseEvents.IResponseEventCatalog.
 */
export interface IResponseEventCatalog {
  /** Every registered mapping, across all pipelines. */
  readonly mappings: readonly IResponseEventMapping[];

  /** Every declaration-only published-event definition. */
  readonly declaredDefinitions: readonly IMessageDefinition[];

  /**
   * Whether any registered mapping could publish an event for a successful response on `topic` (see
   * {@link IResponseEventMapping.covers}). Used by the unmapped-response-handler diagnostic.
   */
  coversTopic(topic: ITopic): boolean;
}

export const IResponseEventCatalog: ServiceToken<IResponseEventCatalog> =
  serviceToken<IResponseEventCatalog>('IResponseEventCatalog');

/**
 * Default {@link IResponseEventCatalog}: aggregates the {@link ResponseEventMappings} singleton
 * instances each `useResponseEvents(...)` call registered. Also an
 * `IMessageDefinitionFinder<IMessageDefinition>`, so mappings with a declared payload type flow into
 * generated specs as published events - one declaration drives both runtime behavior and the spec.
 * Port of Benzene.ResponseEvents.ResponseEventCatalog.
 */
export class ResponseEventCatalog
  implements IResponseEventCatalog, IMessageDefinitionFinder<IMessageDefinition>
{
  readonly mappings: readonly IResponseEventMapping[];
  readonly declaredDefinitions: readonly IMessageDefinition[];

  constructor(
    pipelineMappings: readonly ResponseEventMappings[],
    declarations: readonly ResponseEventDeclarations[],
  ) {
    this.mappings = pipelineMappings.flatMap((x) => [...x.mappings]);
    this.declaredDefinitions = declarations.flatMap((x) => [...x.definitions]);
  }

  coversTopic(topic: ITopic): boolean {
    return this.mappings.some((mapping) => mapping.covers(topic));
  }

  /**
   * Returns a definition for every mapping that declared both an event topic and a payload type, plus
   * every declaration-only definition. Convention rules (which derive topics at runtime) have no static
   * definition and are skipped.
   */
  findDefinitions(): IMessageDefinition[] {
    const fromMappings = this.mappings
      .filter((x) => x.eventTopic !== undefined && x.payloadType !== undefined)
      .map((x) => new ResponseEventDefinition(x.eventTopic!, x.payloadType!));

    return [...fromMappings, ...this.declaredDefinitions];
  }
}
