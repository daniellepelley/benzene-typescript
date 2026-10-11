/** Port of Benzene.Schema.OpenApi.EventService.EventServiceDocumentBuilder (the `benzene` document format). */
import { BenzeneTopic, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { IApplicationInfo, ITransportsInfo, IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { IMessageDefinition, IRequestResponseMessageDefinition, OutboundDeclaration } from '@benzenejs/abstractions-messages';
import { IHttpEndpointDefinition } from '@benzenejs/http';
import { ISchemaBuilder } from '../ISchemaBuilder';
import { Event } from './Event';
import { EventServiceDocument } from './EventServiceDocument';
import { HttpMapping } from './HttpMapping';
import { RequestResponse } from './RequestResponse';
import { Send } from './Send';
import { ContractDocumentRuntime, IServiceDeploymentInfo, ServicePlacement, ServiceProfile } from '../ServiceDeploymentInfo';

/** The members of a Contract Document a producer may be unable to determine (contract-document.md §1 `degraded`). */
export type ContractDocumentMember = 'requests' | 'events' | 'sends';

/**
 * Accumulates the Contract Document (contract-document.md) from the feeds the `SpecBuilder` hands it,
 * delegating every payload schema to the shared `ISchemaBuilder` (so each is stored once in
 * `components.schemas` and referenced by `$ref`). Mirrors the C# builder's `IConsumes*` feeds as plain
 * `add*` methods.
 *
 * - **requests** come from the handler definitions; a handler whose response is `VoidResult` has no
 *   `response` (contract-document.md §2). `benzene:` topics are never listed (§1).
 * - **events** come from response-event (broadcast) definitions and event declarations; **sends** from
 *   sender definitions and send declarations (§3). A (topic, version) declared as both throws (§3.3).
 * - `httpMappings` attach to the `(topic, version)` entry the route reaches.
 */
export class EventServiceDocumentBuilder {
  private readonly requests: RequestResponse[] = [];
  private readonly events: Event[] = [];
  private readonly sends: Send[] = [];
  private readonly defaultVersions = new Map<string, string>();
  private service = '';
  private serviceVersion?: string;
  private versionScheme?: string;
  private description?: string;
  private runtime: string = ContractDocumentRuntime;
  private placement?: ServicePlacement;
  private profile?: ServiceProfile;
  private readonly degraded: ContractDocumentMember[] = [];
  private transports: string[] = [];

  constructor(private readonly schemaBuilder: ISchemaBuilder) {}

  build(): EventServiceDocument {
    const document = new EventServiceDocument(this.requests, this.events, this.schemaBuilder.build(), this.sends);
    document.service = this.service;
    document.serviceVersion = this.serviceVersion;
    // A versionScheme without a serviceVersion orders nothing (service-versions.md §2), so it rides only with one.
    document.versionScheme = this.serviceVersion === undefined ? undefined : this.versionScheme;
    document.description = this.description;
    document.runtime = this.runtime;
    document.placement = this.placement;
    document.profile = this.profile;
    document.degraded = [...this.degraded];
    document.transports = this.transports;
    return document;
  }

  generateJson(): string {
    return JSON.stringify(this.build().toJson());
  }

  /** `service`, `serviceVersion`, `versionScheme` and `description` come from the application's info (§1). */
  addApplicationInfo(applicationInfo: IApplicationInfo): this {
    this.service = applicationInfo.name ?? '';
    this.serviceVersion = applicationInfo.version === '' ? undefined : applicationInfo.version;
    this.versionScheme = applicationInfo.versionScheme === '' ? undefined : applicationInfo.versionScheme;
    this.description = applicationInfo.description === '' ? undefined : applicationInfo.description;
    return this;
  }

  /** `runtime`, `placement` and `profile`: the deployment-side fields the service knows (§1). */
  addDeploymentInfo(deploymentInfo: IServiceDeploymentInfo): this {
    if (deploymentInfo.runtime !== undefined && deploymentInfo.runtime.trim() !== '') {
      this.runtime = deploymentInfo.runtime;
    }
    this.placement = deploymentInfo.placement;
    this.profile = deploymentInfo.profile;
    return this;
  }

  /**
   * Records a member this producer could not determine (§1 `degraded`): it stays in the document, empty, and
   * an empty list then asserts nothing rather than "none".
   */
  addDegraded(member: ContractDocumentMember): this {
    if (!this.degraded.includes(member)) {
      this.degraded.push(member);
    }
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
    if (BenzeneTopic.isReserved(definition.topic.id)) {
      return;
    }
    if (definition.isDefault === true) {
      this.defaultVersions.set(definition.topic.id, definition.topic.version);
    }
    const exists = this.requests.some(
      (request) => request.topic === definition.topic.id && request.version === definition.topic.version,
    );
    if (exists) {
      return;
    }
    const usage = describeUsage(definition.topic.id, definition.topic.version);
    const request = new RequestResponse();
    request.topic = definition.topic.id;
    request.version = definition.topic.version;
    request.request = this.schemaBuilder.addSchema(definition.requestType, `${usage} request`);
    request.response = this.payload(definition.responseType, `${usage} response`);
    this.requests.push(request);
  }

  /** Response-event (broadcast) definitions: topics this service publishes, so `events` (§3.1). */
  addBroadcastEventDefinitions(definitions: IMessageDefinition[]): this {
    for (const definition of definitions) {
      this.addEvent(definition.topic.id, definition.topic.version, definition.requestType);
    }
    return this;
  }

  /** Sender definitions: messages to topics another party defines, so `sends` (§3.2). */
  addMessageSenderDefinitions(definitions: IMessageDefinition[]): this {
    for (const definition of definitions) {
      const responseType = (definition as Partial<IRequestResponseMessageDefinition>).responseType ?? VoidResult;
      this.addSend(definition.topic.id, definition.topic.version, definition.requestType, responseType);
    }
    return this;
  }

  /** Explicit event and send declarations (`MeshOutboundRegistry`, contract-document.md §3.3). */
  addOutboundDeclarations(declarations: readonly OutboundDeclaration[]): this {
    for (const declaration of declarations) {
      if (declaration.kind === 'event') {
        this.addEvent(declaration.topic, declaration.version ?? '', declaration.message ?? VoidResult);
      } else {
        this.addSend(
          declaration.topic,
          declaration.version ?? '',
          declaration.request ?? VoidResult,
          declaration.response ?? VoidResult,
        );
      }
    }
    return this;
  }

  private addEvent(topic: string, version: string, messageType: ServiceIdentifier<unknown>): void {
    if (BenzeneTopic.isReserved(topic)) {
      return;
    }
    this.assertNotBoth(topic, version, this.sends, 'event');
    if (this.events.some((event) => event.topic === topic && event.version === version)) {
      return;
    }
    const event = new Event(topic, this.schemaBuilder.addSchema(messageType, `${describeUsage(topic, version)} event`));
    event.version = version;
    this.events.push(event);
  }

  private addSend(
    topic: string,
    version: string,
    requestType: ServiceIdentifier<unknown>,
    responseType: ServiceIdentifier<unknown>,
  ): void {
    if (BenzeneTopic.isReserved(topic)) {
      return;
    }
    this.assertNotBoth(topic, version, this.events, 'send');
    if (this.sends.some((send) => send.topic === topic && send.version === version)) {
      return;
    }
    const usage = describeUsage(topic, version);
    const send = new Send(topic, this.schemaBuilder.addSchema(requestType, `${usage} send`));
    send.version = version;
    send.response = this.payload(responseType, `${usage} send reply`);
    this.sends.push(send);
  }

  private assertNotBoth(
    topic: string,
    version: string,
    others: ReadonlyArray<{ topic: string; version: string }>,
    kind: 'event' | 'send',
  ): void {
    if (others.some((other) => other.topic === topic && other.version === version)) {
      throw new Error(
        `${describeUsage(topic, version)} is declared both as an event and as a send (adding it as a ${kind}). ` +
          'An event is a topic this service defines; a send targets a topic another party defines - declare it ' +
          'as one or the other (contract-document.md §3.3).',
      );
    }
  }

  /** A payload schema, or `undefined` for "no payload" (`VoidResult`): an absent `response`. */
  private payload(type: ServiceIdentifier<unknown>, usage: string): Record<string, unknown> | undefined {
    return type === VoidResult ? undefined : this.schemaBuilder.addSchema(type, usage);
  }

  addHttpEndpointDefinitions(
    httpEndpointDefinitions: IHttpEndpointDefinition[],
    messageHandlerDefinitions: IMessageHandlerDefinition[],
  ): this {
    this.addMessageHandlerDefinitions(messageHandlerDefinitions);

    for (const endpoint of httpEndpointDefinitions) {
      const request = this.entryReachedBy(endpoint);
      if (request !== undefined) {
        request.httpMappings.push(new HttpMapping(endpoint.method, endpoint.path));
      }
    }
    return this;
  }

  /**
   * The entry an HTTP route reaches: the `(topic, version)` it was declared on; for a route on a bare topic,
   * the handler a request without a version selects (the unversioned one, else the declared default), or the
   * topic's only entry.
   */
  private entryReachedBy(endpoint: IHttpEndpointDefinition): RequestResponse | undefined {
    const forTopic = this.requests.filter((r) => r.topic === endpoint.topic);
    if (endpoint.version !== undefined) {
      return forTopic.find((r) => r.version === endpoint.version);
    }
    const unversioned = forTopic.find((r) => r.version === '');
    if (unversioned !== undefined) {
      return unversioned;
    }
    const defaultVersion = this.defaultVersions.get(endpoint.topic);
    if (defaultVersion !== undefined) {
      return forTopic.find((r) => r.version === defaultVersion);
    }
    return forTopic.length === 1 ? forTopic[0] : undefined;
  }
}

function describeUsage(topic: string, version: string): string {
  return version === '' ? `'${topic}'` : `'${topic}' (version '${version}')`;
}
