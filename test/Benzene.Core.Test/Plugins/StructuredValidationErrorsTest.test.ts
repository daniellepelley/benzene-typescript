import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import Joi from 'joi';
import { z } from 'zod';
import * as yup from 'yup';
import { formatValidationErrors, formatValidationMessages } from '@benzenejs/ajv';
import { joiValidationErrors } from '@benzenejs/joi';
import { yupPathToJsonPointer, yupValidationErrors } from '@benzenejs/yup';
import { zodValidationErrors } from '@benzenejs/zod';

/**
 * One test per validation adapter, all asserting the same thing: the field that failed and the rule
 * that rejected it reach the caller as `field` and `code`, rather than being glued into the message
 * or dropped.
 *
 * They live in one file on purpose. Every adapter's own suite already covers its own wiring; what is
 * easy to lose is that the four agree with each other and with .NET, whose FluentValidation and
 * JsonSchema adapters have produced structured errors all along. Four adapters that each keep only
 * `message` is exactly the state this file was written to prevent recurring - a caller should not
 * have to know which validator a service happens to use in order to know whether it can attach an
 * error to an input.
 *
 * The rule for `field` is the validator's own path, verbatim - the same rule .NET follows, where
 * FluentValidation's `PropertyName` arrives dotted and JsonSchema's `InstanceLocation` arrives as a
 * pointer. So ajv gives a JSON Pointer because that is what ajv produces, and yup gives its dotted
 * path because that is what yup produces. zod and joi report a path as an array with no native
 * string form, so those two are rendered as JSON Pointers - wire-contracts.md section 1.3's
 * "JSON Pointer for schema-based validators" is the tie-breaker where the validator has no opinion.
 */

describe('structured validation errors', () => {
  it('ajv: instancePath becomes field, keyword becomes code', () => {
    const validate = new Ajv().compile({
      type: 'object',
      properties: { name: { type: 'string', maxLength: 5 } },
      required: ['name'],
    });
    validate({ name: 'far-too-long' });

    const errors = formatValidationErrors(validate.errors);

    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('/name');
    expect(errors[0].code).toBe('maxLength');
    expect(errors[0].message).toBeTruthy();
  });

  it('ajv: the flat prose helper still renders "field: message"', () => {
    const validate = new Ajv().compile({
      type: 'object',
      properties: { name: { type: 'string', maxLength: 5 } },
    });
    validate({ name: 'far-too-long' });

    expect(formatValidationMessages(validate.errors)[0]).toMatch(/^\/name: /);
  });

  it('zod: path becomes a JSON Pointer field, issue code becomes code', () => {
    const schema = z.object({ name: z.string().max(5) });
    const result = schema.safeParse({ name: 'far-too-long' });
    expect(result.success).toBe(false);

    const errors = zodValidationErrors(result.error!);

    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('/name');
    expect(errors[0].code).toBe('too_big');
  });

  it('joi: path becomes a JSON Pointer field, type becomes code', () => {
    const schema = Joi.object({ name: Joi.string().max(5).required() });
    const result = schema.validate({ name: 'far-too-long' }, { abortEarly: false });

    const errors = joiValidationErrors(result.error!);

    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('/name');
    expect(errors[0].code).toBe('string.max');
  });

  it('yup: path becomes field, type becomes code', async () => {
    const schema = yup.object({ name: yup.string().max(5) });

    let thrown: yup.ValidationError | undefined;
    try {
      await schema.validate({ name: 'far-too-long' }, { abortEarly: false });
    } catch (error) {
      thrown = error as yup.ValidationError;
    }

    // Assert it actually rejected: without this the test would pass by never entering the catch.
    expect(thrown).toBeDefined();

    const errors = yupValidationErrors(thrown!);
    expect(errors).toHaveLength(1);
    // yup reports a dotted property path; every adapter emits an RFC 6901 JSON Pointer
    // (wire-contracts §1.3, D8), so it is converted.
    expect(errors[0].field).toBe('/name');
    expect(errors[0].code).toBe('max');
  });

  it('every adapter reports a nested field, not just the leaf name', () => {
    const zodErrors = zodValidationErrors(
      z.object({ order: z.object({ sku: z.string() }) }).safeParse({ order: { sku: 1 } }).error!,
    );
    const joiErrors = joiValidationErrors(
      Joi.object({ order: Joi.object({ sku: Joi.string() }) }).validate(
        { order: { sku: 1 } },
        { abortEarly: false },
      ).error!,
    );

    expect(zodErrors[0].field).toBe('/order/sku');
    expect(joiErrors[0].field).toBe('/order/sku');
  });

  it('every adapter addresses a missing array-element member as a JSON Pointer (/items/0/sku)', async () => {
    const request = { name: '', items: [{}] };

    const zodErrors = zodValidationErrors(
      z
        .object({ name: z.string().min(1), items: z.array(z.object({ sku: z.string().min(1) })) })
        .safeParse(request).error!,
    );
    const joiErrors = joiValidationErrors(
      Joi.object({
        name: Joi.string().min(1).required(),
        items: Joi.array().items(Joi.object({ sku: Joi.string().min(1).required() })),
      }).validate(request, { abortEarly: false }).error!,
    );
    let yupError: yup.ValidationError | undefined;
    try {
      await yup
        .object({
          name: yup.string().min(1),
          items: yup.array(yup.object({ sku: yup.string().required() })),
        })
        .validate(request, { abortEarly: false });
    } catch (error) {
      yupError = error as yup.ValidationError;
    }
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        items: { type: 'array', items: { type: 'object', required: ['sku'], properties: { sku: { type: 'string', minLength: 1 } } } },
      },
    });
    validate(request);
    const ajvErrors = formatValidationErrors(validate.errors);

    const fields = (errors: { field?: string }[]) => new Set(errors.map((e) => e.field));
    expect(fields(zodErrors)).toEqual(new Set(['/name', '/items/0/sku']));
    expect(fields(joiErrors)).toEqual(new Set(['/name', '/items/0/sku']));
    expect(fields(yupValidationErrors(yupError!))).toEqual(new Set(['/name', '/items/0/sku']));
    expect(fields(ajvErrors)).toEqual(new Set(['/name', '/items/0/sku']));
  });

  it('yup paths with quoted keys and indexes convert to escaped pointers', () => {
    expect(yupPathToJsonPointer('items[0].sku')).toBe('/items/0/sku');
    expect(yupPathToJsonPointer('meta["a.b"].c')).toBe('/meta/a.b/c');
    expect(yupPathToJsonPointer('weird["x/y~z"]')).toBe('/weird/x~1y~0z');
    expect(yupPathToJsonPointer('')).toBeUndefined();
  });

  it('a root-level failure carries no field at all', () => {
    const zodErrors = zodValidationErrors(z.string().safeParse(42).error!);

    expect(zodErrors[0].field).toBeUndefined();
    expect(zodErrors[0].code).toBeTruthy();
  });
});
