/** Port of Benzene.Azure.Function.Timer.Extensions. */
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { IAzureFunctionApp } from '@benzene/azure-function-core';
import { TimerContext } from './TimerContext';
import { TimerTriggerInfo } from './TimerTriggerInfo';

/**
 * Adds a terminal tick-processing step that receives the `TimerContext` — for scheduled work that
 * doesn't need message-handler routing. The step calls `next` after `process`, exactly as C#.
 *
 * OVERLOAD COLLAPSE: C# has two `UseTick` overloads — one taking `Func<TimerContext, Task>` and a
 * convenience one taking `Func<TimerTriggerInfo, Task>` (implemented as `UseTick(context =>
 * process(context.Timer))`). Both are single-argument function types, indistinguishable once TypeScript
 * erases their parameter types, so they cannot coexist as runtime-discriminated overloads. The port
 * keeps the more general `TimerContext` form; the schedule info is one hop away via `context.timer`, so
 * the convenience overload is expressed as `useTick(app, (context) => process(context.timer))`.
 *
 * @param app The timer pipeline builder.
 * @param process The delegate that consumes the tick.
 */
export function useTick(
  app: IMiddlewarePipelineBuilder<TimerContext>,
  process: (context: TimerContext) => Promise<void> | void,
): IMiddlewarePipelineBuilder<TimerContext> {
  return app.useFn('Tick', async (context, next) => {
    await process(context);
    await next();
  });
}

/**
 * Dispatches a timer tick to the Azure Function app's timer entry point application. Port of C#
 * `Extensions.HandleTimer(this IAzureFunctionApp, TimerTriggerInfo)` and its no-argument overload
 * (`HandleTimer(this IAzureFunctionApp)`), collapsed here into one function with a defaulted parameter
 * — for triggers that don't bind the timer parameter, call it with no `timer`.
 *
 * @param source The built Azure Function app to dispatch to.
 * @param timer The tick's timer information. Defaults to a fresh `TimerTriggerInfo` when omitted.
 */
export function handleTimer(
  source: IAzureFunctionApp,
  timer: TimerTriggerInfo = new TimerTriggerInfo(),
): Promise<void> {
  return source.handleAsync(timer);
}
