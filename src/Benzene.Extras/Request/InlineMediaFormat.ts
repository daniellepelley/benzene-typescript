/** Port of Benzene.Extras.Request.InlineMediaFormat. */
import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import { IMediaFormat } from '@benzene/abstractions-message-handlers';

/** A read/write predicate: does this format apply to the given context? */
export type MediaFormatPredicate<TContext> = (context: TContext, serviceResolver: IServiceResolver) => boolean;

/**
 * An {@link IMediaFormat} built from inline delegates, for registering a format without declaring a
 * dedicated class.
 * Port of Benzene.Extras.Request.InlineMediaFormat&lt;TContext&gt;.
 *
 * The three C# constructor overloads (a context-only predicate, a context+resolver predicate used for
 * both directions, and distinct read/write predicates) collapse into a single constructor taking a
 * {@link MediaFormatPredicate} for reads and an optional separate one for writes (defaulting to the
 * read predicate). A caller wanting the C# context-only overload wraps their predicate to ignore the
 * resolver argument — the same simplification the rest of the port applies to `Func` overloads.
 */
export class InlineMediaFormat<TContext> implements IMediaFormat<TContext> {
  private readonly canReadPredicate: MediaFormatPredicate<TContext>;

  private readonly canWritePredicate: MediaFormatPredicate<TContext>;

  constructor(
    readonly contentType: string,
    private readonly serializer: ISerializer,
    canRead: MediaFormatPredicate<TContext>,
    canWrite?: MediaFormatPredicate<TContext>,
  ) {
    this.canReadPredicate = canRead;
    this.canWritePredicate = canWrite ?? canRead;
  }

  canRead(context: TContext, serviceResolver: IServiceResolver): boolean {
    return this.canReadPredicate(context, serviceResolver);
  }

  canWrite(context: TContext, serviceResolver: IServiceResolver): boolean {
    return this.canWritePredicate(context, serviceResolver);
  }

  getSerializer(_serviceResolver: IServiceResolver): ISerializer {
    return this.serializer;
  }
}
