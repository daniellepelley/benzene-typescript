import { IBenzeneResult, ServiceIdentifier } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { BenzeneResultStatus } from '@benzene/results';
import { isEmptyPayload } from './ExplicitResponseEventMapping';
import { IResponseEventMapping } from './IResponseEventMapping';
import { ResponseEventPublication } from './ResponseEventPublication';

// Verb (lowercased) -> the result status that must accompany it.
const verbToStatus = new Map<string, string>([
  ['create', BenzeneResultStatus.created],
  ['update', BenzeneResultStatus.updated],
  ['delete', BenzeneResultStatus.deleted],
]);

/**
 * The CRUD naming convention as one opt-in {@link IResponseEventMapping}: a topic whose last
 * `:`-segment is `create`/`update`/`delete`, handled with the matching result status
 * (`Created`/`Updated`/`Deleted`) and a payload, publishes that payload on the past-tense topic
 * (`order:create` -> `order:created`). Added via {@link ResponseEventsBuilder.mapCrudConvention}.
 * Port of Benzene.ResponseEvents.CrudConventionResponseEventMapping.
 */
export class CrudConventionResponseEventMapping implements IResponseEventMapping {
  readonly description =
    'CRUD convention: <entity>:create|update|delete -> <entity>:created|updated|deleted on Created/Updated/Deleted';

  readonly sourceTopic: string | undefined = undefined;
  readonly eventTopic: string | undefined = undefined;
  readonly payloadType: ServiceIdentifier<unknown> | undefined = undefined;

  resolve(sourceTopic: ITopic, result: IBenzeneResult): ResponseEventPublication | undefined {
    const verb = lastSegment(sourceTopic.id);
    const requiredStatus = verbToStatus.get(verb);
    if (requiredStatus === undefined || result.status !== requiredStatus) {
      return undefined;
    }

    const payload = result.payloadAsObject;
    return isEmptyPayload(payload)
      ? undefined
      : new ResponseEventPublication(`${sourceTopic.id}d`, payload);
  }

  covers(topic: ITopic): boolean {
    return verbToStatus.has(lastSegment(topic.id));
  }
}

function lastSegment(topicId: string): string {
  const segments = topicId.split(':');
  return (segments[segments.length - 1] ?? '').toLowerCase();
}
