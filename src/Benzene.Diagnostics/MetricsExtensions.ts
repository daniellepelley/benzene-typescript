import { Attributes } from '@opentelemetry/api';
import {
  ICurrentTransport,
  IHasMessageResult,
  IMessageGetter,
} from '@benzene/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { BenzeneDiagnostics } from './BenzeneDiagnostics';

/**
 * Adds middleware that records {@link BenzeneDiagnostics.messagesProcessed} and
 * {@link BenzeneDiagnostics.messageDuration} for each pipeline execution, tagged by topic, transport,
 * and result. Once-per-message granularity - add it explicitly around the stage you want measured.
 * Port of Benzene.Diagnostics.MetricsExtensions.UseBenzeneMetrics.
 *
 * .NET gates recording on `Counter.Enabled` (a no-op when no meter is listening); OpenTelemetry JS's
 * no-op meter already makes `add`/`record` cheap when no SDK is registered, so the port records
 * unconditionally. `Stopwatch` timing maps to `Date.now()` deltas (millisecond resolution), matching the
 * port-wide timing convention.
 */
export function useBenzeneMetrics<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  return app.useFn('BenzeneMetrics', async (context, next, resolver) => {
    const start = Date.now();
    let threw = false;
    try {
      await next();
    } catch (error) {
      threw = true;
      throw error;
    } finally {
      const durationMs = Date.now() - start;

      // Collapse every successful outcome to "success"; itemize failures by their root-cause status. An
      // escaped exception is its own category, distinct from a handler that returned a failure result.
      const result = threw ? 'exception' : outcomeResult(context);

      const messageGetter = resolver.tryGetService(IMessageGetter) as unknown as
        | IMessageGetter<TContext>
        | undefined;
      const attributes: Attributes = {
        topic: messageGetter?.getTopic(context)?.id ?? '<missing>',
        transport: resolver.tryGetService(ICurrentTransport)?.name ?? '<missing>',
        result,
      };

      BenzeneDiagnostics.messagesProcessed.add(1, attributes);
      BenzeneDiagnostics.messageDuration.record(durationMs, attributes);
    }
  });
}

function outcomeResult(context: unknown): string {
  const messageResult = asHasMessageResult(context)?.messageResult as
    | { isSuccessful?: boolean; status?: string }
    | null
    | undefined;
  if (messageResult === undefined || messageResult === null) {
    return '<missing>'; // no result signal set on a non-throwing completion
  }
  if (messageResult.isSuccessful) {
    return 'success';
  }
  return messageResult.status !== undefined && messageResult.status !== '' ? messageResult.status : 'failure';
}

function asHasMessageResult(context: unknown): IHasMessageResult | undefined {
  return typeof context === 'object' && context !== null && 'messageResult' in context
    ? (context as IHasMessageResult)
    : undefined;
}
