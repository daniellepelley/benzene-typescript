import { IServiceResolver } from '@benzene/abstractions';
import { IMediaFormat, IMediaFormatNegotiator } from '@benzene/abstractions-message-handlers';
import { JsonMediaFormat } from './JsonMediaFormat';

/**
 * Default `IMediaFormatNegotiator<TContext>` implementation. Registered scoped (one instance per
 * message), so its memoized selections are correct: every caller within the same message negotiates
 * against the same single `TContext` instance, so caching the first computed decision guarantees
 * `selectWrite`/`selectRead` are each evaluated exactly once per message.
 * Port of Benzene.Core.MessageHandlers.MediaFormats.MediaFormatNegotiator&lt;TContext&gt;.
 */
export class MediaFormatNegotiator<TContext> implements IMediaFormatNegotiator<TContext> {
  private readonly formats: IMediaFormat<TContext>[];
  private selectedRead: IMediaFormat<TContext> | undefined;
  private selectedWrite: IMediaFormat<TContext> | undefined;

  constructor(
    formats: Iterable<IMediaFormat<TContext>>,
    private readonly defaultFormat: JsonMediaFormat<TContext>,
    private readonly serviceResolver: IServiceResolver,
  ) {
    this.formats = Array.from(formats);
  }

  selectRead(context: TContext): IMediaFormat<TContext> {
    if (this.selectedRead === undefined) {
      this.selectedRead =
        this.formats.find((format) => format.canRead(context, this.serviceResolver)) ?? this.defaultFormat;
    }
    return this.selectedRead;
  }

  selectWrite(context: TContext): IMediaFormat<TContext> {
    if (this.selectedWrite === undefined) {
      this.selectedWrite =
        this.formats.find((format) => format.canWrite(context, this.serviceResolver)) ?? this.selectRead(context);
    }
    return this.selectedWrite;
  }
}
