import { IGrpcMethodDefinition } from './IGrpcMethodDefinition';

/** Port of Benzene.Grpc.GrpcMethodDefinition. */
export class GrpcMethodDefinition implements IGrpcMethodDefinition {
  readonly method: string;
  readonly topic: string;

  constructor(method: string, topic: string) {
    this.method = method;
    this.topic = topic;
  }
}
