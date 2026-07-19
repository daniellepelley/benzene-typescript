import { describe, expect, it } from 'vitest';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { CorrelationExtensions } from '@benzene/diagnostics';

/** Port of Benzene.Test.Diagnostics.CorrelationExtensionsTest. */

/** Hand-rolled stand-in for the C# `Mock<IMessageHeadersGetter<string>>`. */
function createHeadersGetter(headers: Record<string, string>): IMessageHeadersGetter<string> {
  return {
    getHeaders: (context) => (context === 'context' ? headers : {}),
  };
}

describe('CorrelationExtensionsTest', () => {
  it('GetHeader_SingleKey_MatchesCaseInsensitively', () => {
    const getter = createHeadersGetter({ TraceParent: 'abc-123' });

    const value = CorrelationExtensions.getHeader(getter, 'context', 'traceparent');

    expect(value).toBe('abc-123');
  });

  it('GetHeader_SingleKey_NotPresent_ReturnsEmptyString', () => {
    const getter = createHeadersGetter({});

    const value = CorrelationExtensions.getHeader(getter, 'context', 'traceparent');

    expect(value).toBe('');
  });

  it('GetHeader_MultipleKeys_ReturnsFirstPresentInGivenOrder', () => {
    const getter = createHeadersGetter({ 'second-choice': 'found-it' });

    const value = CorrelationExtensions.getHeader(getter, 'context', ['first-choice', 'second-choice']);

    expect(value).toBe('found-it');
  });

  it('GetHeader_MultipleKeys_SkipsAnEmptyValueAndTriesTheNextKey', () => {
    const getter = createHeadersGetter({ 'first-choice': '', 'second-choice': 'found-it' });

    const value = CorrelationExtensions.getHeader(getter, 'context', ['first-choice', 'second-choice']);

    expect(value).toBe('found-it');
  });
});
