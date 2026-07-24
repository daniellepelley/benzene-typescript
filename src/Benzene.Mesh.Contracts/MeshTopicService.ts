/** Port of Benzene.Mesh.Contracts.MeshTopicService (+ MeshTopicHttpMapping + MeshTopicProducer). */

/** An HTTP method+path a topic is reachable at on a service. */
export class MeshTopicHttpMapping {
  constructor(
    readonly method: string,
    readonly path: string,
  ) {}
}

/** A single service's consumption (handling) of a topic within a `MeshTopicEntry`. */
export class MeshTopicService {
  constructor(
    readonly service: string,
    readonly httpMappings: MeshTopicHttpMapping[],
  ) {}
}

/** A single service's declaration that it sends (produces) a topic, within a `MeshTopicEntry`. */
export class MeshTopicProducer {
  constructor(readonly service: string) {}
}
