import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { DefaultBenzeneMessageSender } from './DefaultBenzeneMessageSender';
import { IBenzeneMessageSender } from './IBenzeneMessageSender';
import { OutboundRoutingBuilder } from './OutboundRoutingBuilder';
import { OutboundRoutingTopics } from './OutboundRoutingTopics';

/**
 * Top-level DI registration for the outbound routing mechanism.
 * Port of Benzene.Clients.DependencyInjectionExtensions (C# extension method -> free function taking the
 * container as the first argument).
 *
 * Builds the topic-keyed outbound routing table and registers the resulting {@link IBenzeneMessageSender}.
 *
 * @example
 * addOutboundRouting(services, (routing) =>
 *   routing
 *     .route('order:create', (pipeline) => useSqs(pipeline, queueUrl))
 *     .route('audit:log', (pipeline) => useSns(pipeline, topicArn)));
 */
export function addOutboundRouting(
  services: IBenzeneServiceContainer,
  configure: (builder: OutboundRoutingBuilder) => void,
): IBenzeneServiceContainer {
  const builder = new OutboundRoutingBuilder(services);
  configure(builder);
  const routes = builder.build();

  services.addScopedFactory(
    IBenzeneMessageSender,
    (resolver) => new DefaultBenzeneMessageSender(routes, resolver),
  );
  services.addSingletonInstance(OutboundRoutingTopics, new OutboundRoutingTopics(routes.keys()));

  return services;
}
