import { ServiceBusSender } from '@azure/service-bus';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { OutboundServiceBusContextConverter } from './OutboundServiceBusContextConverter';
import { ServiceBusClientMiddleware } from './ServiceBusClientMiddleware';
import { ServiceBusSendMessageContext } from './ServiceBusSendMessageContext';

/**
 * Port of Benzene.Clients.Azure.ServiceBus.Extensions (C# fluent extension methods -> free functions
 * taking the builder first).
 *
 * PORT SCOPE: like the AWS `@benzenejs/clients-aws-*` siblings, this ports the `OutboundContext` send
 * path; the generic `IBenzeneClientContext<T,Void>` overloads and the standalone
 * `ServiceBusBenzeneMessageClient` are deferred (see the README structure table), while the native
 * `ServiceBusBatchMessageClient` IS ported. The C# `.UseServiceBus(action, …)` (custom-middleware) overload is also
 * omitted for now — TypeScript can't overload a free function on `sender`-vs-`action`, and the AWS
 * sibling settled on the sender form; compose a custom pipeline via `useServiceBusClient` if needed.
 */

/** Appends the terminal `ServiceBusClientMiddleware` (built from `sender`) to a Service Bus send pipeline. */
export function useServiceBusClient(
  app: IMiddlewarePipelineBuilder<ServiceBusSendMessageContext>,
  sender: ServiceBusSender,
): IMiddlewarePipelineBuilder<ServiceBusSendMessageContext> {
  return app.use(() => new ServiceBusClientMiddleware(sender));
}

/**
 * Converts an outbound route pipeline (`OutboundRoutingBuilder.route`) to send via Service Bus: the
 * routed message becomes the Service Bus message body, the topic + per-call headers become
 * `applicationProperties`, and the message is sent through the given sender.
 */
export function useServiceBus(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  sender: ServiceBusSender,
  topicPropertyKey: string = OutboundServiceBusContextConverter.DefaultTopicProperty,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(new OutboundServiceBusContextConverter(topicPropertyKey), (builder) =>
    useServiceBusClient(builder, sender),
  );
}
