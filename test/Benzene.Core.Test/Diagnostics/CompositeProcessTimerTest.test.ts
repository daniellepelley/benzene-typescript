import { describe, expect, it } from 'vitest';
import {
  CompositeProcessTimer,
  CompositeProcessTimerFactory,
  IProcessTimer,
  IProcessTimerFactory,
} from '@benzene/diagnostics';

/** Port of Benzene.Test.Diagnostics.CompositeProcessTimerTest. */

/** Hand-rolled stand-in for the C# `Mock<IProcessTimer>`, recording calls. */
class FakeProcessTimer implements IProcessTimer {
  readonly setTagCalls: Array<{ key: string; value: string }> = [];
  disposeCalls = 0;

  setTag(key: string, value: string): void {
    this.setTagCalls.push({ key, value });
  }

  dispose(): void {
    this.disposeCalls++;
  }
}

/** Hand-rolled stand-in for the C# `Mock<IProcessTimerFactory>`. */
class FakeProcessTimerFactory implements IProcessTimerFactory {
  readonly createNames: string[] = [];

  constructor(private readonly timer: IProcessTimer) {}

  create(timerName: string): IProcessTimer {
    this.createNames.push(timerName);
    return this.timer;
  }
}

describe('CompositeProcessTimerTest', () => {
  it('SetTag_FansOutToEveryInnerTimer', () => {
    const first = new FakeProcessTimer();
    const second = new FakeProcessTimer();
    const composite = new CompositeProcessTimer([first, second]);

    composite.setTag('key', 'value');

    expect(first.setTagCalls).toEqual([{ key: 'key', value: 'value' }]);
    expect(second.setTagCalls).toEqual([{ key: 'key', value: 'value' }]);
  });

  it('Dispose_FansOutToEveryInnerTimer', () => {
    const first = new FakeProcessTimer();
    const second = new FakeProcessTimer();
    const composite = new CompositeProcessTimer([first, second]);

    composite.dispose();

    expect(first.disposeCalls).toBe(1);
    expect(second.disposeCalls).toBe(1);
  });

  it('Create_FansOutToEveryInnerFactory_UsingTheSameTimerName', () => {
    const firstTimer = new FakeProcessTimer();
    const firstFactory = new FakeProcessTimerFactory(firstTimer);

    const secondTimer = new FakeProcessTimer();
    const secondFactory = new FakeProcessTimerFactory(secondTimer);

    const compositeFactory = new CompositeProcessTimerFactory(firstFactory, secondFactory);

    const timer = compositeFactory.create('my-timer');
    timer.dispose();

    expect(firstFactory.createNames).toEqual(['my-timer']);
    expect(secondFactory.createNames).toEqual(['my-timer']);
    expect(firstTimer.disposeCalls).toBe(1);
    expect(secondTimer.disposeCalls).toBe(1);
  });
});
