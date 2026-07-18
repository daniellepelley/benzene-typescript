import { describe, expect, it } from 'vitest';
import { BenzeneResultStatus } from '@benzene/results';
import { DefaultValidationStatusMapper, validationStatus } from '@benzene/abstractions-validation';

/**
 * Unit tests for `DefaultValidationStatusMapper` — port of
 * Benzene.FluentValidation.DefaultValidationStatusMapper (hoisted into `@benzene/abstractions-validation`
 * so every schema adapter shares it). The FluentValidation per-error `CustomState` override branch has
 * no schema-neutral equivalent and is omitted, so only the two portable branches are exercised.
 */
describe('DefaultValidationStatusMapper', () => {
  const mapper = new DefaultValidationStatusMapper();

  it('returns the handler @validationStatus when present', () => {
    @validationStatus('Conflict')
    class DecoratedHandler {}

    expect(mapper.getStatus(DecoratedHandler, undefined, undefined)).toBe('Conflict');
  });

  it('falls back to ValidationError for a handler without @validationStatus', () => {
    class PlainHandler {}

    expect(mapper.getStatus(PlainHandler, undefined, undefined)).toBe(
      BenzeneResultStatus.validationError,
    );
  });

  it('falls back to ValidationError when the handler type is undefined', () => {
    expect(mapper.getStatus(undefined, undefined, undefined)).toBe(
      BenzeneResultStatus.validationError,
    );
  });
});
