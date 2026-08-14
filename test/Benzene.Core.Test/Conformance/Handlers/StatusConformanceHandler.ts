import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import { conformanceRegistry } from './GreetConformanceHandler';

export class StatusRequest {
  status = '';
  errors?: string[];
}

export class StatusReply {
  applied = '';
}

/**
 * Canonical conformance handler (see docs/specification/conformance/README.md): returns the requested
 * status verbatim - success-class statuses carry the payload `{ "applied": "<status>" }`, failure-class
 * statuses carry the requested errors.
 */
@message('conformance:status', {
  registry: conformanceRegistry,
  requestType: StatusRequest,
  responseType: StatusReply,
})
export class StatusConformanceHandler implements IMessageHandler<StatusRequest, StatusReply> {
  handleAsync(request: StatusRequest): Promise<IBenzeneResultOf<StatusReply>> {
    if (BenzeneResultStatus.isSuccess(request.status)) {
      const reply = new StatusReply();
      reply.applied = request.status;
      return Promise.resolve(BenzeneResult.set(request.status, reply));
    }

    return Promise.resolve(
      BenzeneResult.setErrors<StatusReply>(request.status, ...(request.errors ?? [])),
    );
  }
}
