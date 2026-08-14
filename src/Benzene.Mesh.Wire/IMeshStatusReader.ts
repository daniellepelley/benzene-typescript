/** Port of Benzene.Mesh.Wire.IMeshStatusReader (and BenzeneMessageMeshStatusReader). */
import { BenzeneMessageContext } from '@benzenejs/core-messages';

/**
 * Reads the invocation's final Benzene status back from a transport context after the pipeline has
 * run - the per-transport adapter the trace middleware uses to fill `MeshTraceEvent.status`,
 * following the same per-context mapper idiom as `IMessageGetter<TContext>`. A transport without a
 * reader degrades to an empty status (docs/specification/mesh.md §3's "no result produced" reading),
 * never an error.
 */
export interface IMeshStatusReader<TContext> {
  getStatus(context: TContext): string | undefined;
}

/** The `BenzeneMessageContext` reader: the response's status code is the wire status. */
export class BenzeneMessageMeshStatusReader implements IMeshStatusReader<BenzeneMessageContext> {
  getStatus(context: BenzeneMessageContext): string | undefined {
    return context.benzeneMessageResponse?.statusCode;
  }
}
