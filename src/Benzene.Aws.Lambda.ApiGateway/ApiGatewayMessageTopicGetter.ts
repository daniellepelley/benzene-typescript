import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { IRouteFinder } from '@benzene/http';
import { ApiGatewayContext } from './ApiGatewayContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayMessageTopicGetter.
 *
 * Maps an HTTP request to a Benzene topic by matching its method + path against the registered
 * routes: `IRouteFinder.find(httpMethod, path)` returns the `HttpTopicRoute` whose registered
 * method+path pattern matches, and its `.topic` becomes the message topic. If nothing matches, a
 * `Topic` with an `undefined` id is returned (an unroutable request), which routing later reports as
 * not-found.
 *
 * The routes come from handlers decorated with `@httpEndpoint('METHOD', '/path')` (the port of the
 * C# `[HttpEndpoint]` attribute), correlated with each handler's `@message` topic by
 * `RegistryHttpEndpointFinder`.
 */
export class ApiGatewayMessageTopicGetter implements IMessageTopicGetter<ApiGatewayContext> {
  constructor(private readonly routeFinder: IRouteFinder) {}

  getTopic(context: ApiGatewayContext): ITopic | undefined {
    const route = this.routeFinder.find(
      context.apiGatewayProxyRequest.httpMethod,
      context.apiGatewayProxyRequest.path,
    );
    return new Topic(route?.topic);
  }
}
