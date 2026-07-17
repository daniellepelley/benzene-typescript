import { describe, expect, it } from 'vitest';
import {
  emailAddress,
  maxLength,
  minLength,
  range,
  regularExpression,
  required,
  stringLength,
  validateObject,
} from '@benzene/data-annotations';

/**
 * Focused unit tests for the decorator-based validator that replaces
 * System.ComponentModel.DataAnnotations.Validator in the TypeScript port.
 */

class RequiredModel {
  @required
  name: string | undefined;
}

class MaxLengthModel {
  @maxLength(10)
  value: string | undefined;
}

class MinLengthModel {
  @minLength(3)
  value: string | undefined;
}

class StringLengthModel {
  @stringLength(5, 2)
  value: string | undefined;
}

class RangeModel {
  @range(1, 10)
  value: number | undefined;
}

class RegexModel {
  @regularExpression('^[a-z]+$')
  value: string | undefined;
}

class EmailModel {
  @emailAddress
  value: string | undefined;
}

function withValue<T extends { value?: unknown }>(model: T, value: unknown): T {
  (model as { value: unknown }).value = value;
  return model;
}

describe('validateObject', () => {
  it('required passes when present and fails when missing/blank', () => {
    const ok = new RequiredModel();
    ok.name = 'foo';
    expect(validateObject(ok)).toEqual([]);

    expect(validateObject(new RequiredModel())).toEqual(['The Name field is required.']);

    const blank = new RequiredModel();
    blank.name = '   ';
    expect(validateObject(blank)).toEqual(['The Name field is required.']);
  });

  it('maxLength passes at/under the limit and fails over it', () => {
    expect(validateObject(withValue(new MaxLengthModel(), 'foo'))).toEqual([]);
    expect(validateObject(withValue(new MaxLengthModel(), 'foo-bar-foo-bar'))).toEqual([
      "The field Value must be a string or array type with a maximum length of '10'.",
    ]);
  });

  it('minLength passes at/over the limit and fails under it', () => {
    expect(validateObject(withValue(new MinLengthModel(), 'abc'))).toEqual([]);
    expect(validateObject(withValue(new MinLengthModel(), 'ab'))).toEqual([
      "The field Value must be a string or array type with a minimum length of '3'.",
    ]);
  });

  it('stringLength enforces both bounds', () => {
    expect(validateObject(withValue(new StringLengthModel(), 'abc'))).toEqual([]);
    expect(validateObject(withValue(new StringLengthModel(), 'a'))).toEqual([
      'The field Value must be a string with a minimum length of 2 and a maximum length of 5.',
    ]);
    expect(validateObject(withValue(new StringLengthModel(), 'abcdef'))).toEqual([
      'The field Value must be a string with a minimum length of 2 and a maximum length of 5.',
    ]);
  });

  it('range passes inside the interval and fails outside', () => {
    expect(validateObject(withValue(new RangeModel(), 5))).toEqual([]);
    expect(validateObject(withValue(new RangeModel(), 20))).toEqual([
      'The field Value must be between 1 and 10.',
    ]);
  });

  it('regularExpression requires a full match', () => {
    expect(validateObject(withValue(new RegexModel(), 'abc'))).toEqual([]);
    expect(validateObject(withValue(new RegexModel(), 'abc123'))).toEqual([
      "The field Value must match the regular expression '^[a-z]+$'.",
    ]);
  });

  it('emailAddress passes a valid address and fails an invalid one', () => {
    expect(validateObject(withValue(new EmailModel(), 'someone@example.com'))).toEqual([]);
    expect(validateObject(withValue(new EmailModel(), 'not-an-email'))).toEqual([
      'The Value field is not a valid e-mail address.',
    ]);
  });

  it('collects one error per failing rule across properties', () => {
    class MultiModel {
      @required
      name: string | undefined;

      @maxLength(3)
      code: string | undefined;
    }

    const model = new MultiModel();
    model.code = 'toolong';
    const errors = validateObject(model);

    expect(errors).toHaveLength(2);
    expect(errors).toContain('The Name field is required.');
    expect(errors).toContain(
      "The field Code must be a string or array type with a maximum length of '3'.",
    );
  });
});
