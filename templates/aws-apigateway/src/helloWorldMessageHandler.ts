import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';
import { IGreeter } from './greeter';

export class HelloWorldRequest {
  name?: string;
}

export class HelloWorldResponse {
  message?: string;
}

// This is a starter handler — replace it with your own, or add more alongside it. Your business logic
// lives here, not in the composition root: a handler receives a typed request and returns a typed
// response, and knows nothing about HTTP, Lambda, or queues — the same handler shape runs unchanged on
// every host Benzene supports.
//
// `@message('hello:world')` maps this handler to its topic — every Benzene transport routes by topic.
// `@httpEndpoint('POST', '/hello')` additionally maps an HTTP method + path onto that same topic.
//
// The handler takes its one collaborator (`IGreeter`) via the constructor; the container injects what
// the static `inject` array lists (TypeScript erases parameter types), and a test can swap it (see `test/`).
@httpEndpoint('POST', '/hello')
@message('hello:world', { requestType: HelloWorldRequest, responseType: HelloWorldResponse })
export class HelloWorldMessageHandler implements IMessageHandler<HelloWorldRequest, HelloWorldResponse> {
  static readonly inject = [IGreeter] as const;

  constructor(private readonly greeter: IGreeter) {}

  handleAsync(request: HelloWorldRequest): Promise<IBenzeneResultOf<HelloWorldResponse>> {
    const response = new HelloWorldResponse();
    response.message = this.greeter.greet(request.name ?? 'World');
    return Promise.resolve(BenzeneResult.ok(response));
  }
}
