import { PutEventsCommandInput, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import { ISerializer, VoidResult } from '@benzenejs/abstractions';
import { IContextConverter } from '@benzenejs/abstractions-middleware';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { convertStatusCode, OutboundContext } from '@benzenejs/clients';
import { EventBridgeSendMessageContext } from './EventBridgeSendMessageContext';

/**
 * Converts an outbound `OutboundContext` into an `EventBridgeSendMessageContext`, so a topic routed here is
 * published as a routed integration event. Port of
 * Benzene.Clients.Aws.EventBridge.OutboundEventBridgeContextConverter.
 *
 * EventBridge routes on the event's `Source`/`DetailType`, so the Benzene routing topic maps to `DetailType`
 * (what the inbound `@benzenejs/aws-lambda-eventbridge` binding reads back as the topic) and the configured
 * `source` maps to `Source`. EventBridge has no native per-message attributes, so per-call headers are
 * embedded in the `Detail` JSON under the reserved `_benzeneHeaders` key (the inbound binding lifts them out).
 */
export class OutboundEventBridgeContextConverter
  implements IContextConverter<OutboundContext, EventBridgeSendMessageContext>
{
  /** Must match the inbound binding's `EventBridgeMessageHeadersGetter` embedded-headers key. */
  static readonly EmbeddedHeadersKey = '_benzeneHeaders';

  private readonly serializer: ISerializer;

  constructor(
    private readonly source: string,
    private readonly eventBusName?: string,
    serializer?: ISerializer,
  ) {
    this.serializer = serializer ?? new JsonSerializer();
  }

  createRequestAsync(contextIn: OutboundContext): Promise<EventBridgeSendMessageContext> {
    const entry: PutEventsRequestEntry = {
      Source: this.source,
      DetailType: contextIn.topic,
      Detail: this.buildDetail(contextIn.request, contextIn.headers),
    };
    if (this.eventBusName) {
      entry.EventBusName = this.eventBusName;
    }

    const request: PutEventsCommandInput = { Entries: [entry] };
    return Promise.resolve(new EventBridgeSendMessageContext(request));
  }

  mapResponseAsync(contextIn: OutboundContext, contextOut: EventBridgeSendMessageContext): Promise<void> {
    const status = contextOut.response?.$metadata?.httpStatusCode ?? 200;
    contextIn.response = convertStatusCode<VoidResult>(status, new VoidResult());
    return Promise.resolve();
  }

  /** Serializes the message; when there are headers and the body is a JSON object, embeds them under the reserved key. */
  private buildDetail(message: unknown, headers: Record<string, string>): string {
    const json = this.serializer.serialize(message);
    if (Object.keys(headers).length === 0) {
      return json;
    }
    let detail: unknown;
    try {
      detail = JSON.parse(json);
    } catch {
      return json;
    }
    if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) {
      return json;
    }
    (detail as Record<string, unknown>)[OutboundEventBridgeContextConverter.EmbeddedHeadersKey] = { ...headers };
    return JSON.stringify(detail);
  }
}
