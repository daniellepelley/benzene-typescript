import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { IRouteFinder } from '@benzene/http';
import { AzureHttpContext, azureHttpRequestPath } from './AzureHttpContext';

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetMessageTopicGetter.
 *
 * Maps an HTTP request to a Benzene topic by matching its method + path against the registered routes:
 * `IRouteFinder.find(method, path)` returns the `HttpTopicRoute` whose registered method+path pattern
 * matches, and its `.topic` becomes the message topic. If nothing matches, a `Topic` with an
 * `undefined` id is returned (an unroutable request), which routing later reports as not-found.
 *
 * FIELD MAPPING: C# used `HttpRequest.Method` + `HttpRequest.Path`; here the method comes from
 * `httpRequest.method` and the path is parsed from `httpRequest.url` via `azureHttpRequestPath`. The
 * routes come from handlers decorated with `@httpEndpoint('METHOD', '/path')` (the port of the C#
 * `[HttpEndpoint]` attribute), correlated with each handler's `@message` topic by the route finder.
 */
export class AzureHttpMessageTopicGetter implements IMessageTopicGetter<AzureHttpContext> {
  constructor(private readonly routeFinder: IRouteFinder) {}

  getTopic(context: AzureHttpContext): ITopic {
    const route = this.routeFinder.find(
      context.httpRequest.method,
      azureHttpRequestPath(context.httpRequest),
    );
    return new Topic(route?.topic);
  }
}
