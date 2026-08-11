/** Port of Benzene.Schema.OpenApi.AsyncApi.AsyncApiDocumentBuilder (the `asyncapi` document format). */
import { ServiceIdentifier } from '@benzene/abstractions';
import { IApplicationInfo, IMessageHandlerDefinition } from '@benzene/abstractions-message-handlers';
import { IMessageDefinition } from '@benzene/abstractions-messages';
import { ISchemaBuilder } from '../ISchemaBuilder';
import { SchemaBuilder } from '../SchemaBuilder';
import { DEFAULT_RESPONSE_TOPIC_SUFFIX } from './AsyncApiSpecOptions';

/** The `info` object of an AsyncAPI document. */
interface AsyncApiInfo {
  title?: string;
  description?: string;
  version?: string;
  tags?: AsyncApiTag[];
}

/** An AsyncAPI `tag`. */
export interface AsyncApiTag {
  name: string;
  description?: string;
}

/** A message container addressed by `address`, holding its named messages. */
interface AsyncApiChannel {
  address: string;
  messages: Record<string, unknown>;
}

/** The AsyncAPI version this builder emits (matching the C# builder's `AsyncApiVersion.AsyncApi3_0`). */
const ASYNC_API_VERSION = '3.0.0';

/**
 * Builds a real **AsyncAPI 3.0** document from a service's handlers, broadcast events, and message senders.
 * Port of Benzene.Schema.OpenApi.AsyncApi.AsyncApiDocumentBuilder.
 *
 * AsyncAPI 3.0 separates *channels* (addressable message containers) from *operations* (what the application
 * does with them), naming the direction explicitly with `action: receive` / `action: send` from the
 * application's perspective. A handler **receives** its request and models its reply with the native `reply`
 * object (pointing at the `<topic>:<suffix>` channel); broadcast events and egress message-senders are things
 * the application **sends**.
 *
 * Divergences from the C# original, both forced by the language:
 * - **Output.** C# hands the model to `ByteBard.AsyncAPI`'s serializer (JSON *or* YAML); the port emits the
 *   document as plain JSON with `JSON.stringify` and carries no YAML dependency, so `SpecBuilder` always
 *   serves JSON.
 * - **Schemas.** C# reflects payload types into schemas (Swashbuckle) and maps `OpenApiSchema` → the AsyncAPI
 *   model; TypeScript erases types, so schemas come from the shared {@link ISchemaBuilder} (the registered
 *   `ITypeJsonSchemaSource`s) and a message's `payload` is the `$ref` it returns — no `OpenApiSchema` mapping
 *   layer, and `components.schemas` holds the plain JSON Schemas directly.
 */
export class AsyncApiDocumentBuilder {
  /**
   * The default suffix appended to a handled topic to name its reply channel's address
   * (`<topic>:response`). Override per-app via `AsyncApiSpecOptions.responseTopicSuffix`.
   */
  static readonly DefaultResponseTopicSuffix = DEFAULT_RESPONSE_TOPIC_SUFFIX;

  private readonly schemaBuilder: ISchemaBuilder;
  private readonly responseTopicSuffix: string;
  private info: AsyncApiInfo = {};
  private readonly tags: AsyncApiTag[] = [];
  private readonly channels: Record<string, AsyncApiChannel> = {};
  private readonly operations: Record<string, unknown> = {};

  constructor(schemaBuilder?: ISchemaBuilder, responseTopicSuffix?: string) {
    this.schemaBuilder = schemaBuilder ?? new SchemaBuilder();
    this.responseTopicSuffix =
      responseTopicSuffix === undefined || responseTopicSuffix.trim() === ''
        ? AsyncApiDocumentBuilder.DefaultResponseTopicSuffix
        : responseTopicSuffix;
  }

  build(): Record<string, unknown> {
    const info: AsyncApiInfo = { ...this.info };
    if (this.tags.length > 0) {
      info.tags = this.tags;
    }

    // AsyncAPI channels carry their messages inline; serialise each channel as `{ address, messages }`.
    const channels: Record<string, unknown> = {};
    for (const [key, channel] of Object.entries(this.channels)) {
      channels[key] = { address: channel.address, messages: channel.messages };
    }

    return {
      asyncapi: ASYNC_API_VERSION,
      id: buildId(this.info.title),
      defaultContentType: 'application/json',
      info,
      channels,
      operations: this.operations,
      components: { schemas: this.schemaBuilder.build() },
    };
  }

  generateJson(): string {
    return JSON.stringify(this.build());
  }

  addApplicationInfo(applicationInfo: IApplicationInfo): this {
    return this.addInfo({
      title: applicationInfo.name,
      description: applicationInfo.description,
      version: applicationInfo.version,
    });
  }

  addInfo(info: AsyncApiInfo): this {
    this.info = info;
    return this;
  }

  addTag(tag: AsyncApiTag): this {
    this.tags.push(tag);
    return this;
  }

  addMessageHandlerDefinitions(messageHandlerDefinitions: IMessageHandlerDefinition[]): this {
    const byTopic = new Map<string, IMessageHandlerDefinition[]>();
    for (const definition of messageHandlerDefinitions) {
      const group = byTopic.get(definition.topic.id) ?? [];
      group.push(definition);
      byTopic.set(definition.topic.id, group);
    }

    for (const [topic, definitions] of byTopic) {
      this.addMessageHandlerDefinition(topic, definitions);
    }
    return this;
  }

  addMessageHandlerDefinition(topic: string, messageHandlerDefinitions: IMessageHandlerDefinition[]): void {
    // The application RECEIVES the request on the topic channel; the reply it sends back is modelled with
    // AsyncAPI 3.0's native `reply` (pointing at the `<topic>:<suffix>` channel).
    const requestChannelKey = this.getOrAddChannel(topic);
    const requestChannel = this.channels[requestChannelKey];
    const requestMessageRefs = messageHandlerDefinitions.map((definition) =>
      messageRef(
        requestChannelKey,
        addMessage(requestChannel, definition.requestType, messageName(topic, definition.topic.version), this.schemaBuilder),
      ),
    );

    const replyChannelKey = this.getOrAddChannel(`${topic}:${this.responseTopicSuffix}`);
    const replyChannel = this.channels[replyChannelKey];
    const replyMessageRefs = messageHandlerDefinitions.map((definition) =>
      messageRef(
        replyChannelKey,
        addMessage(replyChannel, definition.responseType, messageName(topic, definition.topic.version), this.schemaBuilder),
      ),
    );

    this.addOperation(topic, {
      action: 'receive',
      channel: { $ref: `#/channels/${requestChannelKey}` },
      messages: requestMessageRefs,
      reply: {
        channel: { $ref: `#/channels/${replyChannelKey}` },
        messages: replyMessageRefs,
      },
    });
  }

  addBroadcastEventDefinitions(messageDefinitions: IMessageDefinition[]): this {
    for (const messageDefinition of messageDefinitions) {
      this.addSendOnly(messageDefinition.topic.id, messageDefinition.requestType);
    }
    return this;
  }

  addMessageSenderDefinitions(messageDefinitions: IMessageDefinition[]): this {
    for (const messageDefinition of messageDefinitions) {
      this.addSendOnly(messageDefinition.topic.id, messageDefinition.requestType);
    }
    return this;
  }

  // A message the application produces/sends outbound (a broadcast event or an egress send) ⇒
  // action: send, no reply.
  private addSendOnly(topic: string, payloadType: ServiceIdentifier<unknown>): void {
    const channelKey = this.getOrAddChannel(topic);
    const messageKey = addMessage(this.channels[channelKey], payloadType, messageName(topic, ''), this.schemaBuilder);
    this.addOperation(topic, {
      action: 'send',
      channel: { $ref: `#/channels/${channelKey}` },
      messages: [messageRef(channelKey, messageKey)],
    });
  }

  // Returns the channels-map KEY for the given topic address, creating the channel if needed. The real topic
  // (which can contain ':' etc.) is kept as the channel's `address`; the map key is sanitised because
  // AsyncAPI 3.0 requires channel/operation keys to match ^[A-Za-z0-9.\-_]+$.
  private getOrAddChannel(address: string): string {
    for (const [key, channel] of Object.entries(this.channels)) {
      if (channel.address === address) {
        return key;
      }
    }

    const key = uniqueKey(sanitizeKey(address), (k) => k in this.channels);
    this.channels[key] = { address, messages: {} };
    return key;
  }

  private addOperation(topic: string, operation: Record<string, unknown>): void {
    this.operations[uniqueKey(sanitizeKey(topic), (k) => k in this.operations)] = operation;
  }
}

/** Builds the document-root `id`: `urn:benzene:service:<slug>`, or a bare fallback when the title is empty. */
function buildId(title: string | undefined): string {
  const slug = (title ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'urn:benzene:service' : `urn:benzene:service:${slug}`;
}

/** Appends `_2`, `_3`, … to `key` until `exists` reports it free. */
function uniqueKey(key: string, exists: (candidate: string) => boolean): string {
  let unique = key;
  let suffix = 2;
  while (exists(unique)) {
    unique = `${key}_${suffix++}`;
  }
  return unique;
}

/** AsyncAPI 3.0 restricts channel/operation/message map keys to `^[A-Za-z0-9.\-_]+$`. */
function sanitizeKey(value: string): string {
  const key = (value ?? '').replace(/[^A-Za-z0-9.\-_]/g, '_');
  return key === '' ? 'channel' : key;
}

/** Adds a message for `payloadType` to `channel` under a unique key and returns that key. */
function addMessage(
  channel: AsyncApiChannel,
  payloadType: ServiceIdentifier<unknown>,
  name: string,
  schemaBuilder: ISchemaBuilder,
): string {
  const key = uniqueKey(sanitizeKey(typeName(payloadType)), (k) => k in channel.messages);
  channel.messages[key] = {
    name,
    title: name,
    contentType: 'application/json',
    payload: schemaBuilder.addSchema(payloadType),
  };
  return key;
}

function messageRef(channelKey: string, messageKey: string): Record<string, unknown> {
  return { $ref: `#/channels/${channelKey}/messages/${messageKey}` };
}

function messageName(topic: string, version: string): string {
  return version === '' ? topic : `${topic} v${version}`;
}

/** A stable, human-ish name for a payload type — the constructor name, else a generic fallback. */
function typeName(type: ServiceIdentifier<unknown>): string {
  return typeof type === 'function' && type.name !== '' ? type.name : 'Payload';
}
