/** Port of Benzene.Core.Versioning.Response.CastingResponsePayloadMapper. */
import { Constructor, ISerializer, VoidResult } from '@benzene/abstractions';
import {
  IMessageHandlerResult,
  IMessageTopicGetter,
  IMessageVersionGetter,
  IResponsePayloadMapper,
} from '@benzene/abstractions-message-handlers';
import { isRawStringMessage } from '@benzene/abstractions-messages';
import { ISchemaCasters } from '../Schemas/ISchemaCasters';
import { CastMessageHandlerResult } from './CastMessageHandlerResult';
import { ResponseTypeOverrideDefinition } from './ResponseTypeOverrideDefinition';

/**
 * Decorates the transport's real {@link IResponsePayloadMapper}, transparently downcasting the handler's
 * canonical response payload into the version the request declared, so a producer on an older version
 * gets a response in its own version back (symmetric versioning by default). Delegates straight through
 * for failures, no version signal, no resolvable topic/response type, a null or raw-string payload, or
 * no registered downcast caster.
 * Port of Benzene.Core.Versioning.Response.CastingResponsePayloadMapper&lt;TContext&gt;.
 */
export class CastingResponsePayloadMapper<TContext> implements IResponsePayloadMapper<TContext> {
  constructor(
    private readonly inner: IResponsePayloadMapper<TContext>,
    private readonly versionGetter: IMessageVersionGetter<TContext>,
    private readonly topicGetter: IMessageTopicGetter<TContext>,
    private readonly schemaCasters?: ISchemaCasters,
  ) {}

  map(
    context: TContext,
    messageHandlerResult: IMessageHandlerResult,
    serializer: ISerializer,
  ): string | undefined {
    if (this.schemaCasters === undefined || !messageHandlerResult.benzeneResult.isSuccessful) {
      return this.inner.map(context, messageHandlerResult, serializer);
    }

    const version = this.versionGetter.getVersion(context);
    if (version === undefined || version === '') {
      return this.inner.map(context, messageHandlerResult, serializer);
    }

    const topic = this.topicGetter.getTopic(context)?.id;
    const responseType = messageHandlerResult.messageHandlerDefinition?.responseType;
    const payload = messageHandlerResult.benzeneResult.payloadAsObject;

    // C# checks `payload == null`; the port's BenzeneResult substitutes the VoidResult sentinel for a
    // missing payload (BenzeneResult.setErrors/ok()), so treat that as "no payload" too.
    if (
      topic === undefined ||
      topic === '' ||
      responseType === undefined ||
      payload === undefined ||
      payload === null ||
      payload instanceof VoidResult ||
      isRawStringMessage(payload)
    ) {
      return this.inner.map(context, messageHandlerResult, serializer);
    }

    const caster = this.schemaCasters.tryGetSchemaCaster(topic, responseType as Constructor<unknown>, version);
    if (caster === undefined) {
      return this.inner.map(context, messageHandlerResult, serializer);
    }

    const downcast = caster.cast(payload);
    if (downcast === undefined || downcast === null) {
      return this.inner.map(context, messageHandlerResult, serializer);
    }

    const shim = new CastMessageHandlerResult(
      messageHandlerResult.topic,
      new ResponseTypeOverrideDefinition(messageHandlerResult.messageHandlerDefinition!, caster.toType),
      messageHandlerResult.benzeneResult,
      downcast,
    );

    return this.inner.map(context, shim, serializer);
  }
}
