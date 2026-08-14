import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { conformanceRegistry } from './GreetConformanceHandler';

export class PanicRequest {}

export class PanicReply {}

/**
 * Canonical mesh conformance handler (see docs/specification/conformance/README.md): throws
 * unconditionally, pinning the rule that an unhandled handler exception is traced as
 * `service-unavailable` rather than lost (mesh.md §3's structural coverage). Also used by the
 * descriptor cases purely to grow the topic set (the descriptor factory never invokes it).
 */
@message('conformance:panic', {
  registry: conformanceRegistry,
  requestType: PanicRequest,
  responseType: PanicReply,
})
export class PanicConformanceHandler implements IMessageHandler<PanicRequest, PanicReply> {
  handleAsync(): Promise<IBenzeneResultOf<PanicReply>> {
    throw new Error('conformance:panic always throws');
  }
}
