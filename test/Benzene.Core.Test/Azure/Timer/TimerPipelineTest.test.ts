import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, VoidResult } from '@benzene/abstractions';
import { ICurrentTransport, IMessageHandler } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
  usePresetTopic,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { InlineAzureFunctionStartUp } from '@benzene/azure-function-core';
import {
  addAzureTimer,
  handleTimer,
  TimerApplication,
  TimerContext,
  TimerScheduleStatus,
  TimerTriggerInfo,
  useTick,
  useTimerTrigger,
} from '@benzene/azure-function-timer';

/**
 * End-to-end port of the C# Azure timer pipeline tests (TimerPipelineTest.cs): wire the full stack via
 * idiomatic DI and drive a timer tick through the Azure Function entry point / `TimerApplication`
 * pipeline. A timer trigger is a scheduler — a tick carries no message payload — so it is fire-and-forget
 * with no response.
 *
 * SHAPE note (faithful to the C# package): a tick has no message, so it is consumed either directly with
 * `useTick(...)`, or — to run a scheduled job through the same message handlers as any other transport —
 * with `usePresetTopic(...)` + `useMessageHandlers(...)`, where the tick's body is the serialized
 * `TimerTriggerInfo`.
 */

const TOPIC = 'nightly-cleanup';

class Job {
  name: string | undefined;
}

const invoked: string[] = [];

const registry = new MessageHandlersRegistry();

@message(TOPIC, { registry, requestType: Job })
class NightlyCleanupHandler implements IMessageHandler<Job, VoidResult> {
  handleAsync(request: Job): Promise<IBenzeneResultOf<VoidResult>> {
    invoked.push(request.name ?? '<none>');
    return Promise.resolve(BenzeneResult.ok<VoidResult>());
  }
}

describe('TimerPipeline (via AzureFunctionApp entry point)', () => {
  it('delivers the tick to the tick step with its schedule info', async () => {
    let observed: TimerTriggerInfo | undefined;
    const next = new Date(Date.now() + 5 * 60 * 1000);

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useTimerTrigger(builder, (timer) =>
          // The `TimerTriggerInfo` convenience overload is collapsed into the `TimerContext` form (see
          // Extensions.ts); the schedule info is one hop away via `context.timer`.
          useTick(timer, (context) => {
            observed = context.timer;
          }),
        ),
      )
      .build();

    const timer = new TimerTriggerInfo();
    timer.isPastDue = true;
    const status = new TimerScheduleStatus();
    status.next = next;
    timer.scheduleStatus = status;

    await handleTimer(app, timer);

    expect(observed).toBeDefined();
    expect(observed?.isPastDue).toBe(true);
    expect(observed?.scheduleStatus?.next).toBe(next);
  });

  it('routes a preset-topic tick to the message handler', async () => {
    invoked.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useTimerTrigger(builder, (timer) => {
          usePresetTopic(timer, TOPIC);
          useMessageHandlers(timer, NightlyCleanupHandler);
        }),
      )
      .build();

    await handleTimer(app);

    // The tick's body carries only schedule info, so the handler's payload binds with no name — what's
    // proven here is that the tick routed to and invoked the preset topic's handler exactly once.
    expect(invoked).toEqual(['<none>']);
  });

  it('propagates a tick exception so the host records the failure', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useTimerTrigger(builder, (timer) =>
          useTick(timer, () => {
            throw new Error('job failed');
          }),
        ),
      )
      .build();

    await expect(handleTimer(app)).rejects.toThrow('job failed');
  });
});

describe('TimerApplication (direct)', () => {
  it('runs the tick through the pipeline with the timer transport', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addAzureTimer(container);

    let seenTransport: string | undefined;
    let seenPastDue: boolean | undefined;
    const pipeline = new MiddlewarePipelineBuilder<TimerContext>(container);
    pipeline.useFn(async (context, next, resolver) => {
      seenTransport = resolver.getService(ICurrentTransport).name;
      seenPastDue = context.timer.isPastDue;
      await next();
    });

    const application = new TimerApplication(
      pipeline.build(),
      container.createServiceResolverFactory(),
    );

    const timer = new TimerTriggerInfo();
    timer.isPastDue = true;
    await application.sendAsync(timer);

    expect(seenTransport).toBe('timer');
    expect(seenPastDue).toBe(true);
  });
});
