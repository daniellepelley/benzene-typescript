import {
  IBenzeneServiceContainer,
  tryAddScopedFactory,
  tryAddSingletonFactory,
} from '@benzene/abstractions';
import { IMessageRouterBuilder } from '@benzene/abstractions-message-handlers';
import { IMessageDefinition, IMessageDefinitionFinder } from '@benzene/abstractions-messages';
import { IBenzeneMessageSender } from '@benzene/clients';
import { BenzeneMessageSenderResponseEventPublisher } from './BenzeneMessageSenderResponseEventPublisher';
import { IResponseEventPublisher } from './IResponseEventPublisher';
import { IResponseEventCatalog, ResponseEventCatalog } from './ResponseEventCatalog';
import { ResponseEventDeclarations } from './ResponseEventDeclarations';
import { ResponseEventMappings } from './ResponseEventMappings';
import { ResponseEventsBuilder } from './ResponseEventsBuilder';
import { ResponseEventsMiddlewareBuilder } from './ResponseEventsMiddlewareBuilder';

/**
 * Registration entry point for response events - republishing a handler's response payload as a
 * follow-up event.
 * Port of Benzene.ResponseEvents.ResponseEventsExtensions (C# extension methods -> free functions).
 */

/**
 * Adds response-event publishing to this pipeline's handler dispatch: after a handler runs, every
 * configured mapping that matches the (topic, result) pair publishes the response payload as an event
 * through the registered {@link IResponseEventPublisher} (by default,
 * {@link BenzeneMessageSenderResponseEventPublisher} over `IBenzeneMessageSender` - each event topic
 * needs an `addOutboundRouting` route). Scoped to the pipeline whose
 * `useMessageHandlers(..., router => ...)` call this is made in.
 */
export function useResponseEvents(
  builder: IMessageRouterBuilder,
  configure: (builder: ResponseEventsBuilder) => void,
): IMessageRouterBuilder {
  const responseEventsBuilder = new ResponseEventsBuilder();
  configure(responseEventsBuilder);
  const mappings = responseEventsBuilder.build();

  builder.add(new ResponseEventsMiddlewareBuilder(mappings));
  builder.register((services) => {
    services.addSingletonInstance(ResponseEventMappings, mappings);
    tryAddScopedFactory(
      services,
      IResponseEventPublisher,
      (resolver) => new BenzeneMessageSenderResponseEventPublisher(resolver.getService(IBenzeneMessageSender)),
    );
    addResponseEventCatalog(services);
  });

  return builder;
}

/**
 * Declares published events that don't come from a response mapping - events handler code sends
 * directly - so they still appear in generated specs and in {@link IResponseEventCatalog}. Purely
 * declarative: registers no runtime behavior.
 */
export function addResponseEventDeclarations(
  services: IBenzeneServiceContainer,
  ...definitions: IMessageDefinition[]
): IBenzeneServiceContainer {
  services.addSingletonInstance(ResponseEventDeclarations, new ResponseEventDeclarations(definitions));
  addResponseEventCatalog(services);
  return services;
}

function addResponseEventCatalog(services: IBenzeneServiceContainer): void {
  tryAddSingletonFactory(
    services,
    ResponseEventCatalog,
    (resolver) =>
      new ResponseEventCatalog(
        resolver.getServices(ResponseEventMappings),
        resolver.getServices(ResponseEventDeclarations),
      ),
  );
  tryAddSingletonFactory(services, IResponseEventCatalog, (resolver) =>
    resolver.getService(ResponseEventCatalog),
  );
  tryAddSingletonFactory(services, IMessageDefinitionFinder, (resolver) =>
    resolver.getService(ResponseEventCatalog),
  );
}
