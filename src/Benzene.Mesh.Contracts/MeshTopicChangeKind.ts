/** Port of Benzene.Mesh.Contracts.MeshTopicChangeKind. */

/** The kinds of run-over-run topic catalog change the aggregator detects. Loose string constants. */
export const MeshTopicChangeKind = {
  /** The (topic, version) was not declared anywhere in the previous run. */
  added: 'topic-added',

  /** The topic's payload schema (request, response, or message side) changed since the previous run. */
  schemaChanged: 'schema-changed',

  /** The set of services declaring they produce this topic changed since the previous run. */
  producersChanged: 'producers-changed',

  /** The set of services handling this topic changed since the previous run. */
  consumersChanged: 'consumers-changed',
} as const;
