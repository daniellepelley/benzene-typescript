import { describe, expect, it } from 'vitest';
import { CorrelationId } from '@benzene/diagnostics';

/** Port of Benzene.Test.Diagnostics.CorrelationIdTest. */
describe('CorrelationIdTest', () => {
  it('Get_NothingSet_ReturnsANonEmptySelfGeneratedValue', () => {
    const correlationId = new CorrelationId();

    expect(correlationId.get()).not.toBe('');
    expect(correlationId.get()).toBeTruthy();
  });

  it('Set_ValidValue_OverridesTheSelfGeneratedValue', () => {
    const correlationId = new CorrelationId();

    correlationId.set('my-correlation-id');

    expect(correlationId.get()).toBe('my-correlation-id');
  });

  // C# [Theory] with [InlineData(null)] / [InlineData("")].
  it.each([
    ['undefined', undefined as unknown as string],
    ['empty', ''],
  ])('Set_NullOrEmptyValue_LeavesTheExistingValueUnchanged (%s)', (_label, value) => {
    const correlationId = new CorrelationId();
    const original = correlationId.get();

    correlationId.set(value);

    expect(correlationId.get()).toBe(original);
  });

  it('Set_CalledTwice_LatestValueWins', () => {
    const correlationId = new CorrelationId();

    correlationId.set('first');
    correlationId.set('second');

    expect(correlationId.get()).toBe('second');
  });
});
