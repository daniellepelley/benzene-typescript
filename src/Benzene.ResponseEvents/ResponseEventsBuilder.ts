import { Constructor } from '@benzene/abstractions';
import {
  ExplicitResponseEventMapping,
  ResponseEventWhen,
} from './ExplicitResponseEventMapping';
import { IResponseEventMapping } from './IResponseEventMapping';
import { PublishFailureMode } from './PublishFailureMode';
import { ResponseEventMappings } from './ResponseEventMappings';
import { CrudConventionResponseEventMapping } from './CrudConventionResponseEventMapping';

/**
 * Fluent configuration surface for one pipeline's response-event mappings, passed to the callback of
 * {@link useResponseEvents}.
 * Port of Benzene.ResponseEvents.ResponseEventsBuilder.
 */
export class ResponseEventsBuilder {
  private readonly mappings: IResponseEventMapping[] = [];
  private publishFailureMode: PublishFailureMode = PublishFailureMode.FailMessage;

  /**
   * Maps one source topic's successful, payload-carrying responses to an event topic.
   * @param when Optional predicate over the handler's result replacing the default `isSuccessful` check
   * (a non-empty payload is always required).
   */
  map(sourceTopic: string, eventTopic: string, when?: ResponseEventWhen): this {
    this.mappings.push(new ExplicitResponseEventMapping(sourceTopic, eventTopic, undefined, when));
    return this;
  }

  /**
   * Maps one source topic's successful responses to an event topic, declaring the event payload type -
   * which surfaces the event in generated specs via {@link ResponseEventCatalog} - and optionally
   * reshaping the payload.
   *
   * Port of C#'s `Map<TPayload>(...)`: because TypeScript erases generics, the payload type is passed
   * explicitly as a class constructor rather than inferred from `typeof(TPayload)`.
   * @param project Optional projection from the response payload to the event payload; returning
   * `undefined`/`null` skips the publish for that message.
   */
  mapWithPayload<TPayload>(
    payloadType: Constructor<TPayload>,
    sourceTopic: string,
    eventTopic: string,
    when?: ResponseEventWhen,
    project?: (payload: TPayload) => unknown,
  ): this {
    this.mappings.push(
      new ExplicitResponseEventMapping(
        sourceTopic,
        eventTopic,
        payloadType,
        when,
        project === undefined ? undefined : (payload) => project(payload as TPayload),
      ),
    );
    return this;
  }

  /**
   * Adds the CRUD naming convention: `X:create`/`update`/`delete` handled with status
   * `Created`/`Updated`/`Deleted` publishes the payload on `X:created`/`updated`/`deleted`.
   */
  mapCrudConvention(): this {
    this.mappings.push(new CrudConventionResponseEventMapping());
    return this;
  }

  /** Adds a fully custom mapping rule - the escape hatch when neither explicit maps nor the CRUD convention fit. */
  add(mapping: IResponseEventMapping): this {
    this.mappings.push(mapping);
    return this;
  }

  /** Sets what happens when publishing a matched event fails. Defaults to {@link PublishFailureMode.FailMessage}. */
  onPublishFailure(mode: PublishFailureMode): this {
    this.publishFailureMode = mode;
    return this;
  }

  /** Builds the immutable mapping set. Normally invoked by {@link useResponseEvents}. */
  build(): ResponseEventMappings {
    return new ResponseEventMappings([...this.mappings], this.publishFailureMode);
  }
}
