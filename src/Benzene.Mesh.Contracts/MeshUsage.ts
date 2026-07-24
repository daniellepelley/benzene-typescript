/** Port of Benzene.Mesh.Contracts.MeshUsage. */
import { MeshUsageEntry } from './MeshUsageEntry';

/**
 * Observed topic-usage counts published by one or more usage sources - the `usage.json` shape. Answers
 * "how often is each topic actually exercised, and over which transports" from observed traffic.
 * `DateTimeOffset`/`DateTimeOffset?` -> `number`/`number | undefined` (epoch ms).
 */
export class MeshUsage {
  constructor(
    readonly generatedAtUtc: number,
    readonly windowStartUtc: number | undefined,
    readonly windowEndUtc: number | undefined,
    readonly entries: MeshUsageEntry[],
  ) {}
}
