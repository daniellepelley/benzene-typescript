import { IStreamCheckpointer } from './IStreamCheckpointer';
import { NullStreamCheckpointer } from './NullStreamCheckpointer';

/**
 * Port of Benzene.Core.Middleware.StreamContext&lt;TItem&gt;.
 *
 * The pipeline context for a stream: the whole batch/stream presented as one context (fan-in),
 * rather than fanned out into one context per item. Stream middleware consumes {@link items}
 * directly, which lets it window, aggregate, order-by-key, and checkpoint — none of which are
 * possible once a batch has been fanned out into isolated per-item contexts.
 *
 * Platform mappings:
 * - `IAsyncEnumerable<TItem>` → `AsyncIterable<TItem>` (consumers use `for await (const x of items)`).
 * - `CancellationToken` → `AbortSignal | undefined` (optional; operators check `signal?.aborted`).
 *   This mirrors the `IBenzeneWorker` mapping already established in the port.
 * - `IDictionary<string, object>` → `Record<string, unknown>`.
 * - C# optional-with-default constructor args → optional args defaulted in the body; C# `null` →
 *   `undefined`.
 *
 * @typeParam TItem The type of item flowing through the stream.
 */
export class StreamContext<TItem> {
  /** The items in the stream, iterated lazily (supports backpressure). */
  readonly items: AsyncIterable<TItem>;

  /** The checkpoint hook for acknowledging progress to the transport. */
  readonly checkpointer: IStreamCheckpointer<TItem>;

  /**
   * Cancellation for long-lived streams; the pipeline signature carries no signal, so it rides here.
   * `undefined` when the transport supplies none.
   */
  readonly signal: AbortSignal | undefined;

  /** Transport metadata that doesn't fit the item shape (partition id, consumer group, …). */
  readonly metadata: Record<string, unknown>;

  /**
   * @param items The stream of items, pulled lazily so the pipeline can apply backpressure.
   * @param checkpointer The checkpoint hook; defaults to {@link NullStreamCheckpointer}.
   * @param signal Cancellation for the stream (the pipeline itself carries none).
   * @param metadata Optional transport metadata (partition id, consumer group, etc.).
   */
  constructor(
    items: AsyncIterable<TItem>,
    checkpointer?: IStreamCheckpointer<TItem>,
    signal?: AbortSignal,
    metadata?: Record<string, unknown>,
  ) {
    this.items = items;
    this.checkpointer =
      checkpointer ?? (NullStreamCheckpointer.instance as IStreamCheckpointer<TItem>);
    this.signal = signal;
    this.metadata = metadata ?? {};
  }
}
