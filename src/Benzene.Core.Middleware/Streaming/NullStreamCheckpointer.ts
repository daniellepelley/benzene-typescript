import { IStreamCheckpointer } from './IStreamCheckpointer';

/**
 * Port of Benzene.Core.Middleware.NullStreamCheckpointer&lt;TItem&gt;.
 *
 * A no-op {@link IStreamCheckpointer} — the default for transports that manage checkpointing
 * themselves (e.g. the Azure Functions Event Hubs extension), or when no checkpointing is required.
 *
 * Platform mapping: C#'s single shared `static readonly Instance` field maps to a `static readonly
 * instance` property; `Task.CompletedTask` maps to `Promise.resolve()`.
 *
 * @typeParam TItem The type of item flowing through the stream.
 */
export class NullStreamCheckpointer<TItem> implements IStreamCheckpointer<TItem> {
  /** The shared instance. */
  static readonly instance = new NullStreamCheckpointer<unknown>();

  checkpointAsync(_lastProcessed: TItem): Promise<void> {
    return Promise.resolve();
  }
}
