/**
 * Port of Benzene.Core.Middleware.IStreamCheckpointer&lt;TItem&gt;.
 *
 * A transport-supplied hook a streaming pipeline can call to checkpoint (acknowledge) progress —
 * telling the underlying runtime "everything up to and including this item has been processed".
 * Transports that checkpoint themselves supply {@link NullStreamCheckpointer}.
 *
 * Platform mapping: C# `Task` → `Promise<void>`. This hook is supplied on the
 * {@link StreamContext} rather than resolved from the DI container, so — unlike container-resolved
 * interfaces in the port — it declares no `ServiceToken`.
 *
 * @typeParam TItem The type of item flowing through the stream.
 */
export interface IStreamCheckpointer<TItem> {
  /**
   * Checkpoints progress up to and including `lastProcessed`.
   *
   * @param lastProcessed The last item successfully processed.
   */
  checkpointAsync(lastProcessed: TItem): Promise<void>;
}
