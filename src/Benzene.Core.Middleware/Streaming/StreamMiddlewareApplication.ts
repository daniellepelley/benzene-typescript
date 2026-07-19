import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { MiddlewareApplication } from '../MiddlewareApplication';
import { StreamContext } from './StreamContext';

/**
 * Port of Benzene.Core.Middleware.StreamMiddlewareApplication&lt;TEvent, TItem&gt;.
 *
 * An entry-point application that presents a whole runtime event (a batch/stream) to the pipeline
 * as a *single* {@link StreamContext} and runs the pipeline once — fanning *in*. Contrast
 * `MiddlewareMultiApplication`, which fans a batch *out* into one context per item.
 *
 * The C# type is a primary-constructor subclass:
 * `StreamMiddlewareApplication<TEvent, TItem> : MiddlewareApplication<TEvent, StreamContext<TItem>>`,
 * forwarding the pipeline and the `event → StreamContext<TItem>` mapper to the base constructor.
 * This port extends the ported {@link MiddlewareApplication} the same way, passing the pipeline and
 * mapper through `super(...)`.
 *
 * @typeParam TEvent The raw runtime event type (e.g. an array of records).
 * @typeParam TItem The type of item the event is projected into.
 */
export class StreamMiddlewareApplication<TEvent, TItem> extends MiddlewareApplication<
  TEvent,
  StreamContext<TItem>
> {
  constructor(
    pipeline: IMiddlewarePipeline<StreamContext<TItem>>,
    mapper: (event: TEvent) => StreamContext<TItem>,
  ) {
    super(pipeline, mapper);
  }
}
