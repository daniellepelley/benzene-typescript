/** Port of Benzene.Aws.Lambda.XRay.XRayMiddlewareDecorator. */
import { IServiceResolver, serviceIdentifierName } from '@benzene/abstractions';
import {
  ICurrentTransport,
  IMessageGetter,
  IMessageHandlerDefinitionLookUp,
  TransportNames,
} from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { IXRayRecorder, XRayRecorder } from './IXRayRecorder';

// The value ICurrentTransport reports before any transport pipeline has recorded itself; the subsegment
// skips the transport annotation while it still reads this (avoids stamping "<missing>" on the outer
// probe stages a multi-transport function walks).
const unresolvedTransport = TransportNames.Unresolved;

/**
 * Wraps a single middleware in an AWS X-Ray subsegment (named after the middleware), so every pipeline
 * stage appears as a timed subsegment nested under the Lambda's X-Ray segment. The direct-to-X-Ray twin
 * of `Benzene.Diagnostics.ActivityMiddlewareDecorator` — it talks to the AWS X-Ray SDK (via
 * {@link IXRayRecorder}) rather than emitting an OpenTelemetry span, so subsegments land in X-Ray
 * directly with no OTLP collector in between.
 *
 * A no-op when there is no active X-Ray segment in context (off Lambda, or on Lambda with active tracing
 * off) — {@link IXRayRecorder.beginSubsegment} returns `false` and the inner middleware just runs. On
 * Lambda with active tracing on, the runtime populates the X-Ray context per invocation, so the
 * subsegment nests under the Lambda's own segment automatically. X-Ray annotation keys must be
 * alphanumeric/underscore (dots are rejected), so these use `benzene_*` keys rather than the `benzene.*`
 * names the Activity decorator uses.
 */
export class XRayMiddlewareDecorator<TContext> implements IMiddleware<TContext> {
  constructor(
    private readonly inner: IMiddleware<TContext>,
    private readonly serviceResolver: IServiceResolver,
    private readonly recorder: IXRayRecorder = XRayRecorder.instance,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    if (!this.recorder.beginSubsegment(this.inner.name)) {
      // No active X-Ray segment (not on Lambda, or active tracing off) — trace nothing, just run on.
      await this.inner.handleAsync(context, next);
      return;
    }

    try {
      this.tag(context);
      await this.inner.handleAsync(context, next);
    } catch (error) {
      // Record the exception so the subsegment shows as a fault at the failing stage, then rethrow
      // untouched — this only observes, it doesn't handle.
      this.recorder.addException(error);
      throw error;
    } finally {
      this.recorder.endSubsegment();
    }
  }

  private tag(context: TContext): void {
    const transport = this.serviceResolver.tryGetService(ICurrentTransport);
    if (transport !== undefined && transport.name !== unresolvedTransport) {
      this.recorder.addAnnotation('benzene_transport', transport.name);
    }

    const messageGetter = this.serviceResolver.tryGetService(IMessageGetter) as unknown as
      | IMessageGetter<TContext>
      | undefined;
    const topic = messageGetter?.getTopic(context);
    if (topic !== undefined && topic.id !== '') {
      this.recorder.addAnnotation('benzene_topic', topic.id);
      if (topic.version !== '') {
        this.recorder.addAnnotation('benzene_version', topic.version);
      }

      const handler = this.serviceResolver
        .tryGetService(IMessageHandlerDefinitionLookUp)
        ?.findHandler(topic);
      if (handler !== undefined) {
        this.recorder.addAnnotation('benzene_handler', serviceIdentifierName(handler.handlerType));
      }
    }
  }
}
