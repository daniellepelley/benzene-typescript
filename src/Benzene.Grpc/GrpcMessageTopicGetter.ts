import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { GrpcContext } from './GrpcContext';

/**
 * Port of Benzene.Grpc.GrpcMessageTopicGetter. The routing topic is the one the route finder already
 * resolved from the gRPC method path and stored on the context, so this just wraps `context.topic`.
 */
export class GrpcMessageTopicGetter implements IMessageTopicGetter<GrpcContext> {
  getTopic(context: GrpcContext): ITopic {
    return new Topic(context.topic);
  }
}
