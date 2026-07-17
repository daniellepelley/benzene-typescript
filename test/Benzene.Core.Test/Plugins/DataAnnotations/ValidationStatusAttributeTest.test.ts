import { describe, expect, it } from 'vitest';
import { getValidationStatus, validationStatus } from '@benzene/abstractions-validation';

/**
 * Unit tests for the `@validationStatus` decorator / `getValidationStatus` reader — the port of
 * Benzene.Abstractions.Validation.ValidationStatusAttribute.
 */
describe('validationStatus', () => {
  it('records the status on a decorated class and reads it back', () => {
    @validationStatus('MyStatus')
    class Decorated {}

    expect(getValidationStatus(Decorated)).toBe('MyStatus');
  });

  it('returns undefined for an undecorated class', () => {
    class Plain {}

    expect(getValidationStatus(Plain)).toBeUndefined();
  });

  it('works as a plain function for non-decorator environments', () => {
    class ManualTarget {}
    validationStatus('Manual')(ManualTarget);

    expect(getValidationStatus(ManualTarget)).toBe('Manual');
  });
});
