/** Port of Benzene.Azure.Function.Timer.TimerApplication. */
import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { EntryPointMiddlewareApplication, MiddlewareApplication } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzene/core-message-handlers';
import { TimerContext } from './TimerContext';
import { TimerTriggerInfo } from './TimerTriggerInfo';

/**
 * The entry point application for a timer-triggered Azure Function. Maps the tick to a `TimerContext`
 * and runs it through the middleware pipeline, tagging the transport as `"timer"` for the duration.
 *
 * FAITHFUL to the C#: `TimerApplication : EntryPointMiddlewareApplication<TimerTriggerInfo>` wrapping a
 * single-tick `MiddlewareApplication<TimerTriggerInfo, TimerContext>` (NOT a batch/multi application —
 * a timer fires one tick per invocation) over a `TransportMiddlewarePipeline<TimerContext>("timer",
 * ...)`. All three are already ported. `AzureFunctionApp` dispatches to it via the fire-and-forget
 * `handleAsync` path.
 */
export class TimerApplication extends EntryPointMiddlewareApplication<TimerTriggerInfo> {
  /**
   * @param pipeline The built timer middleware pipeline to run each tick through.
   * @param serviceResolverFactory The service resolver factory used to process each invocation.
   */
  constructor(
    pipeline: IMiddlewarePipeline<TimerContext>,
    serviceResolverFactory: IServiceResolverFactory,
  ) {
    super(
      new MiddlewareApplication<TimerTriggerInfo, TimerContext>(
        new TransportMiddlewarePipeline<TimerContext>(TransportNames.Timer, pipeline),
        (timer) => new TimerContext(timer),
      ),
      serviceResolverFactory,
    );
  }
}
