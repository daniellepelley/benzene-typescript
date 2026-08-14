import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { GrpcContext } from './GrpcContext';

/**
 * Port of Benzene.Grpc.GrpcMessageBodyGetter.
 *
 * Serializes the request payload to a JSON string for header/body-driven middleware. .NET special-cases a
 * `Google.Protobuf.IMessage` (formatting it via protobuf's `JsonFormatter`) before falling back to
 * `System.Text.Json`; the port has no framework protobuf message type (see {@link JsonGrpcMessageAdapter}),
 * so the grpc-js request — already a plain object — is serialized with `JSON.stringify`. `undefined`/`null`
 * maps to `undefined`.
 */
export class GrpcMessageBodyGetter implements IMessageBodyGetter<GrpcContext> {
  getBody(context: GrpcContext): string | undefined {
    const request = context.requestAsObject;
    if (request === undefined || request === null) {
      return undefined;
    }

    return JSON.stringify(request);
  }
}
