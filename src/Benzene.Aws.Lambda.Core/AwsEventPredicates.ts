/**
 * Event-shape predicates: the single source of truth for "which AWS event source produced this parsed
 * event?". Each mirrors the discriminant AWS puts on the event JSON (the record `eventSource`/`EventSource`,
 * the top-level `httpMethod`, the v2 `requestContext.http`, EventBridge's `detail-type`+`source`, …).
 *
 * Both the per-transport `*LambdaHandler.canHandle` (its native sniff) and `CompositeAwsLambdaEntryPoint`
 * (which dispatches one Lambda's several triggers to the right entry point) resolve the same question, so
 * they share these predicates rather than each re-implementing the shape check.
 */
export type AwsEventPredicate = (event: unknown) => boolean;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** The `eventSource`/`EventSource` of the first `Records[]` entry, or `undefined` for a non-`Records` event. */
function firstRecordSource(event: unknown, field: 'eventSource' | 'EventSource'): string | undefined {
  const records = asRecord(event)?.['Records'];
  if (!Array.isArray(records) || records.length === 0) {
    return undefined;
  }
  const value = asRecord(records[0])?.[field];
  return typeof value === 'string' ? value : undefined;
}

/** API Gateway REST API (payload format 1.0): the method is the top-level `httpMethod`. */
export const isApiGatewayEvent: AwsEventPredicate = (event) => asRecord(event)?.['httpMethod'] != null;

/** API Gateway HTTP API (payload format 2.0): `version === "2.0"` or the method under `requestContext.http`. */
export const isApiGatewayV2Event: AwsEventPredicate = (event) => {
  const e = asRecord(event);
  if (e?.['version'] === '2.0') {
    return true;
  }
  const http = asRecord(asRecord(e?.['requestContext'])?.['http']);
  return http?.['method'] != null;
};

export const isSqsEvent: AwsEventPredicate = (event) => firstRecordSource(event, 'eventSource') === 'aws:sqs';

// SNS records use PascalCase field names (a real AWS quirk): `EventSource`, not `eventSource`.
export const isSnsEvent: AwsEventPredicate = (event) => firstRecordSource(event, 'EventSource') === 'aws:sns';

export const isKinesisEvent: AwsEventPredicate = (event) =>
  firstRecordSource(event, 'eventSource') === 'aws:kinesis';

export const isDynamoDbEvent: AwsEventPredicate = (event) =>
  firstRecordSource(event, 'eventSource') === 'aws:dynamodb';

export const isS3Event: AwsEventPredicate = (event) => firstRecordSource(event, 'eventSource') === 'aws:s3';

export const isEventBridgeEvent: AwsEventPredicate = (event) => {
  const e = asRecord(event);
  return e?.['detail-type'] != null && e?.['source'] != null;
};

/**
 * A direct BenzeneMessage invocation — a transport-neutral `{ topic, headers?, body? }` envelope invoked
 * straight on the function (the Lambda-to-Lambda path the mesh uses to interrogate a service with the
 * reserved `spec`/`healthcheck` topics). Discriminated by a non-empty top-level `topic` (.NET checks
 * `request?.Topic != null`); no proxy/record/detail-type event carries a top-level `topic`, so it is
 * unambiguous against every other predicate.
 */
export const isBenzeneMessageEvent: AwsEventPredicate = (event) => {
  const topic = asRecord(event)?.['topic'];
  return typeof topic === 'string' && topic.length > 0;
};

/**
 * API Gateway REQUEST-type custom (Lambda) authorizer: `type === "REQUEST"` with a non-empty
 * `requestContext.apiId`. The `type` discriminant is what separates it from a v1 proxy event, which also
 * carries `requestContext.apiId` but no `type` (in .NET the payload is deserialized into the distinct
 * authorizer type first, so an API-ID check alone suffices; the erased port sniffs the raw event and needs
 * the extra discriminant). A TOKEN authorizer has no `requestContext`, so — as in .NET — it never matches.
 */
export const isApiGatewayCustomAuthorizerEvent: AwsEventPredicate = (event) => {
  const e = asRecord(event);
  if (e?.['type'] !== 'REQUEST') {
    return false;
  }
  const apiId = asRecord(e?.['requestContext'])?.['apiId'];
  return typeof apiId === 'string' && apiId.length > 0;
};

export const isKafkaEvent: AwsEventPredicate = (event) => asRecord(event)?.['eventSource'] === 'aws:kafka';
