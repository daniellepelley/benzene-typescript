import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { conformanceRegistry } from './GreetConformanceHandler';

export class PanicRequest {
  reason = '';
}

export class PanicReply {
  handled = false;
}

/**
 * Canonical conformance handler (see docs/specification/conformance/README.md). Used here only to grow
 * the topic set, so the descriptorHash's sensitivity to topics can be asserted.
 */
@message('conformance:panic', {
  registry: conformanceRegistry,
  requestType: PanicRequest,
  responseType: PanicReply,
})
export class PanicConformanceHandler implements IMessageHandler<PanicRequest, PanicReply> {
  handleAsync(): Promise<IBenzeneResultOf<PanicReply>> {
    const reply = new PanicReply();
    reply.handled = true;
    return Promise.resolve(BenzeneResult.ok(reply));
  }
}
