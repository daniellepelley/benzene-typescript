import {
  IBenzeneResult,
  ServiceIdentifier,
  serviceIdentifierName,
  VoidResult,
} from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { IResponseEventMapping } from './IResponseEventMapping';
import { ResponseEventPublication } from './ResponseEventPublication';

/** Predicate over a handler result deciding whether to publish. */
export type ResponseEventWhen = (result: IBenzeneResult) => boolean;

/** Projection from the response payload to the event payload; returning `undefined`/`null` skips the publish. */
export type ResponseEventProject = (payload: unknown) => unknown;

/**
 * The standard {@link IResponseEventMapping}: a fixed source topic mapped to a fixed event topic. By
 * default it fires when the handler's result is successful and carries a payload; an optional `when`
 * predicate replaces the status check (the payload requirement always applies - there is no event to
 * publish without one), and an optional projector reshapes the payload before publishing (returning
 * `undefined`/`null` skips the publish).
 * Port of Benzene.ResponseEvents.ExplicitResponseEventMapping.
 */
export class ExplicitResponseEventMapping implements IResponseEventMapping {
  readonly sourceTopic: string;
  readonly eventTopic: string;
  readonly payloadType: ServiceIdentifier<unknown> | undefined;
  private readonly when: ResponseEventWhen | undefined;
  private readonly projectPayload: ResponseEventProject | undefined;

  constructor(
    sourceTopic: string,
    eventTopic: string,
    payloadType?: ServiceIdentifier<unknown>,
    when?: ResponseEventWhen,
    projectPayload?: ResponseEventProject,
  ) {
    this.sourceTopic = sourceTopic;
    this.eventTopic = eventTopic;
    this.payloadType = payloadType;
    this.when = when;
    this.projectPayload = projectPayload;
  }

  get description(): string {
    return (
      `${this.sourceTopic} -> ${this.eventTopic}` +
      (this.payloadType !== undefined ? ` (${serviceIdentifierName(this.payloadType)})` : '') +
      (this.when !== undefined ? ' [conditional]' : '')
    );
  }

  resolve(sourceTopic: ITopic, result: IBenzeneResult): ResponseEventPublication | undefined {
    if (sourceTopic.id.toLowerCase() !== this.sourceTopic.toLowerCase()) {
      return undefined;
    }

    if (!(this.when !== undefined ? this.when(result) : result.isSuccessful)) {
      return undefined;
    }

    let payload = result.payloadAsObject;
    if (isEmptyPayload(payload)) {
      return undefined;
    }

    if (this.projectPayload !== undefined) {
      payload = this.projectPayload(payload);
      if (isEmptyPayload(payload)) {
        return undefined;
      }
    }

    return new ResponseEventPublication(this.eventTopic, payload);
  }

  covers(topic: ITopic): boolean {
    return topic.id.toLowerCase() === this.sourceTopic.toLowerCase();
  }
}

/**
 * Whether a payload counts as "nothing to publish". C# checks `payload == null`; the TypeScript port's
 * void/no-payload sentinel is a `VoidResult` instance (what `BenzeneResult.accepted<T>()` etc. carry),
 * so both `null`/`undefined` and a `VoidResult` are treated as empty.
 */
export function isEmptyPayload(payload: unknown): boolean {
  return payload === null || payload === undefined || payload instanceof VoidResult;
}
