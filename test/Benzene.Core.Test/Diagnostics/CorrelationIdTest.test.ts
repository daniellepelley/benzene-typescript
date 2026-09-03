import { describe, expect, it } from 'vitest';
import { CorrelationId } from '@benzenejs/diagnostics';

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

  // #64: a caller-controlled value carrying embedded CR/LF (plus forged content, as a real attacker
  // would send) must be rejected outright - the self-generated UUID stays in place - so it can never
  // round-trip verbatim into a log scope (CRLF/log-forging) or an outbound header (header injection).
  it('Set_ValueWithEmbeddedCrLf_IsRejected_SelfGeneratedIdStaysInPlace', () => {
    const correlationId = new CorrelationId();
    const original = correlationId.get();

    correlationId.set('real-id\r\nX-Forged-Header: evil\r\n\r\nForged-Log-Line: injected');

    expect(correlationId.get()).toBe(original);
    expect(correlationId.get()).not.toContain('\r');
    expect(correlationId.get()).not.toContain('\n');
  });

  it.each([
    ['CR', 'bad\rid'],
    ['LF', 'bad\nid'],
    ['TAB', 'bad\tid'],
    ['NUL', 'bad\0id'],
    ['DEL', 'bad\u007fid'],
    ['C1', 'bad\u0085id'],
  ])('Set_ValueWithAnyControlCharacter_IsRejected (%s)', (_label, value) => {
    const correlationId = new CorrelationId();
    const original = correlationId.get();

    correlationId.set(value);

    expect(correlationId.get()).toBe(original);
  });

  it('Set_ValueLongerThanMaxLength_IsRejected', () => {
    const correlationId = new CorrelationId();
    const original = correlationId.get();

    correlationId.set('a'.repeat(CorrelationId.maxLength + 1));

    expect(correlationId.get()).toBe(original);
  });

  it('Set_ValueAtMaxLength_IsAccepted', () => {
    const correlationId = new CorrelationId();
    const value = 'a'.repeat(CorrelationId.maxLength);

    correlationId.set(value);

    expect(correlationId.get()).toBe(value);
  });
});
