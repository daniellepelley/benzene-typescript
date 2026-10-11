import { describe, expect, it } from 'vitest';
import { findMetadataValue, isMetadataKey, withoutMetadataKey } from '@benzenejs/core-messages';

/**
 * The reserved-key rules the native-metadata inbound bindings share (wire-contracts.md §2); the
 * fixture-driven proof is `TransportMetadataConformanceTest`, which runs them through every binding.
 */
describe('MetadataTopic', () => {
  it('matches a reserved key case-insensitively', () => {
    expect(isMetadataKey('Topic', 'topic')).toBe(true);
    expect(isMetadataKey('benzene-topic', 'topic')).toBe(false);
    expect(findMetadataValue({ TOPIC: 'a' }, 'topic')).toBe('a');
  });

  it('prefers an exact-case key when a producer sent two spellings', () => {
    expect(findMetadataValue({ Topic: 'other', topic: 'exact' }, 'topic')).toBe('exact');
  });

  it('is undefined for an absent key or no metadata', () => {
    expect(findMetadataValue({ 'x-correlation-id': 'abc' }, 'topic')).toBeUndefined();
    expect(findMetadataValue(undefined, 'topic')).toBeUndefined();
    expect(findMetadataValue(null, 'topic')).toBeUndefined();
  });

  it('removes every spelling of the consumed key and keeps the rest', () => {
    expect(withoutMetadataKey({ topic: 'a', Topic: 'b', tenant: 'acme', 'benzene-version': '2' }, 'topic')).toEqual({
      tenant: 'acme',
      'benzene-version': '2',
    });
  });
});
