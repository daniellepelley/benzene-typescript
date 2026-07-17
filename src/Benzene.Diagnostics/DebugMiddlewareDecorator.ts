/** Port of Benzene.Diagnostics.DebugMiddlewareDecorator. */
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';

/**
 * The debug output sink. Port of the destination of C# `System.Diagnostics.Debug.WriteLine`.
 */
export type DebugSink = (message: string) => void;

/**
 * A no-op debug sink — the default. Mirrors C# `Debug.WriteLine`, which is a no-op unless a
 * `TraceListener` is attached (and is compiled out entirely in Release builds): the decorator
 * produces no output of its own unless a sink is explicitly supplied.
 */
const noopSink: DebugSink = () => {};

/**
 * Wraps an inner middleware and emits debug output around its execution.
 * Port of Benzene.Diagnostics.DebugMiddlewareDecorator&lt;TContext&gt;.
 *
 * Deviation: C# writes to `System.Diagnostics.Debug.WriteLine`. TypeScript/Node has no such
 * ambient debug channel, so output is routed to an injectable {@link DebugSink} callback that
 * defaults to a no-op (matching `Debug.WriteLine`'s silent-by-default behavior) rather than
 * hard-coding `console` noise. Tests observe behavior via the sink.
 */
export class DebugMiddlewareDecorator<TContext> implements IMiddleware<TContext> {
  private readonly inner: IMiddleware<TContext>;
  private readonly sink: DebugSink;

  constructor(inner: IMiddleware<TContext>, sink: DebugSink = noopSink) {
    this.inner = inner;
    this.sink = sink;
  }

  get name(): string {
    return this.inner.name;
  }

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    this.sink(`Middleware - ${this.inner.name} starting`);
    await this.inner.handleAsync(context, next);
    this.sink(`Middleware - ${this.inner.name} completed`);
  }
}
