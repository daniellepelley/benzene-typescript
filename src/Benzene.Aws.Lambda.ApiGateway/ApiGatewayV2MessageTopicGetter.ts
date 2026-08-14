import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { Topic } from '@benzenejs/core-messages';
import { IRouteFinder } from '@benzenejs/http';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2MessageTopicGetter.
 *
 * Maps an API Gateway HTTP API v2 request to a Benzene topic by matching its method + path (from
 * `requestContext.http`) against the registered `@httpEndpoint` routes. An unmatched request yields a
 * `Topic` with an `undefined` id (routing then reports not-found).
 */
export class ApiGatewayV2MessageTopicGetter implements IMessageTopicGetter<ApiGatewayV2Context> {
  constructor(private readonly routeFinder: IRouteFinder) {}

  getTopic(context: ApiGatewayV2Context): ITopic | undefined {
    // method/path are undefined only on a non-v2 event, which never reaches this pipeline; `?? ''`
    // simply matches no route (not-found) rather than throwing on the erased `find(string, string)`.
    const route = this.routeFinder.find(context.method ?? '', context.path ?? '');
    return new Topic(route?.topic);
  }
}
