/** Port of Benzene.Schema.OpenApi.EventService.EventServiceDocumentBuilder (the `benzene` document format). */
import { IApplicationInfo, ITransportsInfo, IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { IMessageDefinition } from '@benzenejs/abstractions-messages';
import { IHttpEndpointDefinition } from '@benzenejs/http';
import { ISchemaBuilder } from '../ISchemaBuilder';
import { ReservedTopics } from '../ReservedTopics';
import { Event } from './Event';
import { EventServiceDocument } from './EventServiceDocument';
import { HttpMapping } from './HttpMapping';
import { RequestResponse } from './RequestResponse';

/**
 * Accumulates the `benzene` spec document from the handler/http/sender/broadcast definitions the
 * `SpecBuilder` feeds it, delegating every payload schema to the shared `ISchemaBuilder` (so each is stored
 * once in `components.schemas` and referenced by `$ref`). Mirrors the C# builder's `IConsumes*` feeds as
 * plain `add*` methods.
 */
export class EventServiceDocumentBuilder {
  private readonly requests: RequestResponse[] = [];
  private readonly events: Event[] = [];
  private info?: EventServiceDocument['info'];
  private transports: string[] = [];

  constructor(private readonly schemaBuilder: ISchemaBuilder) {}

  build(): EventServiceDocument {
    const document = new EventServiceDocument(this.requests, this.events, this.schemaBuilder.build());
    document.info = this.info;
    document.transports = this.transports;
    return document;
  }

  generateJson(): string {
    return JSON.stringify(this.build().toJson());
  }

  addApplicationInfo(applicationInfo: IApplicationInfo): this {
    this.info = {
      title: applicationInfo.name,
      description: applicationInfo.description,
      version: applicationInfo.version,
    };
    return this;
  }

  addTransportsInfo(transportsInfo: ITransportsInfo): this {
    this.transports = [...transportsInfo.transports];
    return this;
  }

  addMessageHandlerDefinitions(definitions: IMessageHandlerDefinition[]): this {
    for (const definition of definitions) {
      this.addMessageHandlerDefinition(definition);
    }
    return this;
  }

  addMessageHandlerDefinition(definition: IMessageHandlerDefinition): void {
    const exists = this.requests.some(
      (request) => request.topic === definition.topic.id && request.version === definition.topic.version,
    );
    if (exists) {
      return;
    }
    const request = new RequestResponse();
    request.topic = definition.topic.id;
    request.version = definition.topic.version;
    request.reserved = ReservedTopics.isReserved(definition.topic.id);
    request.request = this.schemaBuilder.addSchema(definition.requestType);
    request.response = this.schemaBuilder.addSchema(definition.responseType);
    this.requests.push(request);
  }

  addBroadcastEventDefinitions(definitions: IMessageDefinition[]): this {
    for (const definition of definitions) {
      this.addEventDefinition(definition);
    }
    return this;
  }

  addMessageSenderDefinitions(definitions: IMessageDefinition[]): this {
    for (const definition of definitions) {
      this.addEventDefinition(definition);
    }
    return this;
  }

  private addEventDefinition(definition: IMessageDefinition): void {
    // The broadcast and sender feeds can name the same topic; keep one event per (topic, version).
    const exists = this.events.some(
      (event) => event.topic === definition.topic.id && event.version === definition.topic.version,
    );
    if (exists) {
      return;
    }
    const event = new Event(definition.topic.id, this.schemaBuilder.addSchema(definition.requestType));
    event.version = definition.topic.version;
    this.events.push(event);
  }

  addHttpEndpointDefinitions(
    httpEndpointDefinitions: IHttpEndpointDefinition[],
    messageHandlerDefinitions: IMessageHandlerDefinition[],
  ): this {
    this.addMessageHandlerDefinitions(messageHandlerDefinitions);

    // Group endpoints by topic and attach their method/path to the matching request entry.
    const byTopic = new Map<string, HttpMapping[]>();
    for (const endpoint of httpEndpointDefinitions) {
      const mappings = byTopic.get(endpoint.topic) ?? [];
      mappings.push(new HttpMapping(endpoint.method, endpoint.path));
      byTopic.set(endpoint.topic, mappings);
    }
    for (const [topic, mappings] of byTopic) {
      const request = this.requests.find((r) => r.topic === topic);
      if (request !== undefined) {
        request.httpMappings = mappings;
      }
    }
    return this;
  }
}
