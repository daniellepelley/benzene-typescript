import { IBenzeneResult } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { IResponseEventMapping } from './IResponseEventMapping';
import { PublishFailureMode } from './PublishFailureMode';
import { ResponseEventPublication } from './ResponseEventPublication';

/**
 * One pipeline's immutable set of response-event mappings plus its publish-failure policy. Built by
 * {@link ResponseEventsBuilder}, held by that pipeline's {@link ResponseEventsMiddlewareBuilder}, and
 * also registered as a DI singleton instance so {@link ResponseEventCatalog} can aggregate every
 * pipeline's mappings for introspection.
 * Port of Benzene.ResponseEvents.ResponseEventMappings.
 */
export class ResponseEventMappings {
  /** The mappings, in registration order. */
  readonly mappings: readonly IResponseEventMapping[];

  /** What to do when publishing a matched event fails. */
  readonly publishFailureMode: PublishFailureMode;

  constructor(mappings: readonly IResponseEventMapping[], publishFailureMode: PublishFailureMode) {
    this.mappings = mappings;
    this.publishFailureMode = publishFailureMode;
  }

  /**
   * Resolves every mapping that fires for the given handled message, in registration order. Multiple
   * matches are allowed - each one publishes (fan-out).
   */
  resolve(sourceTopic: ITopic, result: IBenzeneResult): ResponseEventPublication[] {
    const publications: ResponseEventPublication[] = [];
    for (const mapping of this.mappings) {
      const publication = mapping.resolve(sourceTopic, result);
      if (publication !== undefined) {
        publications.push(publication);
      }
    }

    return publications;
  }
}
