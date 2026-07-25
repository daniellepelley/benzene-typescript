import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';

/** The registry the conformance handlers register with, keeping them out of the global one. */
export const conformanceRegistry = new MessageHandlersRegistry();

export class GreetRequest {
  name = '';
}

export class GreetReply {
  greeting = '';
}

/**
 * Canonical conformance handler (see docs/specification/conformance/README.md): every Benzene
 * implementation registers this exact topic and behavior natively before running the fixtures.
 */
@message('conformance:greet', {
  registry: conformanceRegistry,
  requestType: GreetRequest,
  responseType: GreetReply,
})
export class GreetConformanceHandler implements IMessageHandler<GreetRequest, GreetReply> {
  handleAsync(request: GreetRequest): Promise<IBenzeneResultOf<GreetReply>> {
    const reply = new GreetReply();
    reply.greeting = `Hello ${request.name}`;
    return Promise.resolve(BenzeneResult.ok(reply));
  }
}
