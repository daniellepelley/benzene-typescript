/** Port of Benzene.Schema.OpenApi.SpecBuilder (the `benzene` format dispatch). */
import { IServiceResolver } from '@benzene/abstractions';
import { ITypeJsonSchemaSource } from '@benzene/abstractions-validation';
import {
  IApplicationInfo,
  IMessageHandlersFinder,
  ITransportsInfo,
} from '@benzene/abstractions-message-handlers';
import { IMessageDefinitionFinder, IMessageSendersFinder } from '@benzene/abstractions-messages';
import { IHttpEndpointFinder } from '@benzene/http';
import { EventServiceDocumentBuilder } from './EventService/EventServiceDocumentBuilder';
import { SchemaBuilder } from './SchemaBuilder';
import { SpecRequest } from './SpecRequest';

/**
 * Builds a service's spec document by pulling every self-description feed from the container and pushing it
 * into an `EventServiceDocumentBuilder`. Only the `benzene` document format is ported (the C# `openapi`/
 * `asyncapi` formats are not), so `specRequest.type`/`format` are currently ignored.
 *
 * The schema catalogue is sourced from the registered `ITypeJsonSchemaSource`s (validation-derived /
 * bring-your-own) rather than CLR reflection — the same seam the mesh descriptor uses. A registered
 * `ISchemaBuilder` is NOT consulted here (the C# BYO-schema-builder swap): in the port, bring-your-own is a
 * `MapTypeJsonSchemaSource` registered alongside the validators, so it flows through the same source list.
 */
export class SpecBuilder {
  createSpec(resolver: IServiceResolver, _specRequest: SpecRequest): string {
    const schemaBuilder = new SchemaBuilder(resolver.getServices(ITypeJsonSchemaSource));
    const builder = new EventServiceDocumentBuilder(schemaBuilder);

    const applicationInfo = resolver.tryGetService(IApplicationInfo);
    if (applicationInfo !== undefined) {
      builder.addApplicationInfo(applicationInfo);
    }

    const handlersFinder = resolver.tryGetService(IMessageHandlersFinder);
    const httpEndpointFinder = resolver.tryGetService(IHttpEndpointFinder);
    if (handlersFinder !== undefined && httpEndpointFinder !== undefined) {
      builder.addHttpEndpointDefinitions(httpEndpointFinder.findDefinitions(), handlersFinder.findDefinitions());
    } else if (handlersFinder !== undefined) {
      builder.addMessageHandlerDefinitions(handlersFinder.findDefinitions());
    }

    const broadcastFinder = resolver.tryGetService(IMessageDefinitionFinder);
    if (broadcastFinder !== undefined) {
      builder.addBroadcastEventDefinitions(broadcastFinder.findDefinitions());
    }

    const sendersFinder = resolver.tryGetService(IMessageSendersFinder);
    if (sendersFinder !== undefined) {
      builder.addMessageSenderDefinitions(sendersFinder.findDefinitions());
    }

    const transportsInfo = resolver.tryGetService(ITransportsInfo);
    if (transportsInfo !== undefined) {
      builder.addTransportsInfo(transportsInfo);
    }

    return builder.generateJson();
  }
}
