/** Port of Benzene.Schema.OpenApi.SpecBuilder (the format dispatch). */
import { IServiceResolver } from '@benzenejs/abstractions';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import {
  IApplicationInfo,
  IMessageHandlersFinder,
  ITransportsInfo,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageDefinitionFinder, IMessageSendersFinder } from '@benzenejs/abstractions-messages';
import { IHttpEndpointFinder } from '@benzenejs/http';
import { AsyncApiDocumentBuilder } from './AsyncApi/AsyncApiDocumentBuilder';
import { AsyncApiSpecOptions } from './AsyncApi/AsyncApiSpecOptions';
import { EventServiceDocumentBuilder } from './EventService/EventServiceDocumentBuilder';
import { OpenApiDocumentBuilder } from './OpenApi/OpenApiDocumentBuilder';
import { SchemaBuilder } from './SchemaBuilder';
import { SpecRequest } from './SpecRequest';

/**
 * Builds a service's spec document, dispatching on `specRequest.type` to one of three document formats — the
 * default `benzene` event-service document, real `openapi` (OpenAPI 3.0), or real `asyncapi` (AsyncAPI 3.0).
 * Each format pulls only the self-description feeds it consumes from the container (mirroring the C#
 * `IConsumes*` interface probing in `CreateSpec<TBuilder>`) and delegates every payload schema to a fresh
 * `SchemaBuilder`.
 *
 * The schema catalogue is sourced from the registered `ITypeJsonSchemaSource`s (validation-derived /
 * bring-your-own) rather than CLR reflection — the same seam the mesh descriptor uses. A registered
 * `ISchemaBuilder` is NOT consulted here (the C# BYO-schema-builder swap): in the port, bring-your-own is a
 * `MapTypeJsonSchemaSource` registered alongside the validators, so it flows through the same source list.
 *
 * Divergence: C# can serialise any builder as YAML when `specRequest.format === 'yaml'`; the port emits JSON
 * for every format (OpenAPI/AsyncAPI's universal interchange format) and carries no YAML dependency, so
 * `format` is not consulted.
 */
export class SpecBuilder {
  createSpec(resolver: IServiceResolver, specRequest: SpecRequest): string {
    switch (specRequest.type?.toLowerCase()) {
      case 'openapi':
        return this.createOpenApi(resolver);
      case 'asyncapi':
        return this.createAsyncApi(resolver);
      case 'benzene':
      default:
        return this.createBenzene(resolver);
    }
  }

  private schemaBuilder(resolver: IServiceResolver): SchemaBuilder {
    return new SchemaBuilder(resolver.getServices(ITypeJsonSchemaSource));
  }

  private createBenzene(resolver: IServiceResolver): string {
    const builder = new EventServiceDocumentBuilder(this.schemaBuilder(resolver));

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

  private createOpenApi(resolver: IServiceResolver): string {
    const builder = new OpenApiDocumentBuilder(this.schemaBuilder(resolver));

    const applicationInfo = resolver.tryGetService(IApplicationInfo);
    if (applicationInfo !== undefined) {
      builder.addApplicationInfo(applicationInfo);
    }

    const handlersFinder = resolver.tryGetService(IMessageHandlersFinder);
    const httpEndpointFinder = resolver.tryGetService(IHttpEndpointFinder);
    if (handlersFinder !== undefined && httpEndpointFinder !== undefined) {
      builder.addHttpEndpointDefinitions(httpEndpointFinder.findDefinitions(), handlersFinder.findDefinitions());
    }

    return builder.generateJson();
  }

  private createAsyncApi(resolver: IServiceResolver): string {
    const options = resolver.tryGetService(AsyncApiSpecOptions);
    const builder = new AsyncApiDocumentBuilder(this.schemaBuilder(resolver), options?.responseTopicSuffix);

    const applicationInfo = resolver.tryGetService(IApplicationInfo);
    if (applicationInfo !== undefined) {
      builder.addApplicationInfo(applicationInfo);
    }

    const handlersFinder = resolver.tryGetService(IMessageHandlersFinder);
    if (handlersFinder !== undefined) {
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

    return builder.generateJson();
  }
}
