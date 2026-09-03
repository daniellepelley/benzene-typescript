import { ISerializer } from '@benzenejs/abstractions';
import { OutboundContext } from '@benzenejs/clients';
import { BenzeneMessageRequest, IBenzeneMessageRequest } from '@benzenejs/core-messages';

/**
 * Builds the `BenzeneMessageRequest` an `OutboundContext` becomes for in-process dispatch - shared by
 * `InProcessContextConverter` (single-target `useInProcess(name)`) and
 * `InProcessFanOutClientMiddleware` (multi-target `useInProcessFanOut(targets)`), so both build the
 * exact same request shape from the same outbound context.
 * Port of Benzene.Clients.InProcess.InProcessRequestBuilder (internal in C#; exported here since
 * TypeScript has no package-internal visibility modifier).
 */
export function buildInProcessRequest(
  context: OutboundContext,
  serializer: ISerializer,
  topic: string = context.topic,
): IBenzeneMessageRequest {
  const request = new BenzeneMessageRequest();
  request.topic = topic;
  request.headers = context.headers;
  request.body = serializer.serialize(context.request);
  // Thread the caller's abort signal onto the dispatched envelope request (structurally - the wire
  // shape has no signal member), the same convention the BenzeneMessage-over-HTTP endpoint uses, so
  // the in-process handler pipeline can observe it via `context.benzeneMessageRequest.signal`.
  (request as IBenzeneMessageRequest & { signal?: AbortSignal }).signal = context.signal;
  return request;
}
