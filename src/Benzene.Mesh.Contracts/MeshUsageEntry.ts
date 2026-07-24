/** Port of Benzene.Mesh.Contracts.MeshUsageEntry. */

/**
 * One usage count in a `MeshUsage` report: how many messages were handled for `topic`, at exactly the
 * dimensions this entry states. A `undefined` dimension means the source's backend doesn't have it (not
 * "all"). `long`/`double?` -> `number`/`number | undefined`.
 */
export class MeshUsageEntry {
  /**
   * @param version Topic version, or `undefined` when the source doesn't discriminate versions.
   * @param service Handling service, or `undefined` when counts can't be attributed per service.
   * @param transport Transport the messages arrived over, or `undefined` when the source lacks that dimension.
   * @param status Result status/class, or `undefined` when not split by outcome.
   * @param avgDurationMs Mean handling duration (ms), or `undefined` if the source doesn't measure it.
   * @param source Which adapter produced this entry - see `MeshUsageSource`.
   */
  constructor(
    readonly topic: string,
    readonly version: string | undefined,
    readonly service: string | undefined,
    readonly transport: string | undefined,
    readonly status: string | undefined,
    readonly count: number,
    readonly avgDurationMs: number | undefined,
    readonly source: string,
  ) {}
}
