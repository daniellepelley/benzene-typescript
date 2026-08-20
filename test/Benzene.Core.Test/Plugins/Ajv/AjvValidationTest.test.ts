import { describe, expect, it } from 'vitest';
import { BenzeneClientContext, IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import {
  AjvSchemaRegistry,
  formatValidationErrors,
  formatValidationMessages,
  registerJsonSchema,
  ValidationClientMiddleware,
} from '@benzenejs/ajv';

/**
 * Unit tests for the ajv adapter's registry, error formatting, and client-side middleware — the ajv
 * counterparts of the Zod adapter's `ZodSchemaRegistryTest` / `ValidationClientMiddlewareTest`. The schema
 * is a hand-authored JSON Schema; the client middleware resolves it from the message instance's constructor.
 */

class ClientRequest {
  name: string | undefined;
}

registerJsonSchema(ClientRequest, {
  type: 'object',
  properties: { name: { type: 'string', maxLength: 10 } },
  required: ['name'],
});

class UnvalidatedRequest {
  value: string | undefined;
}

function contextFor<TRequest>(message: TRequest): BenzeneClientContext<TRequest, unknown> {
  const request: IBenzeneClientRequest<TRequest> = { topic: 'topic', message, headers: {} };
  const context = new BenzeneClientContext<TRequest, unknown>(request);
  context.response = BenzeneResult.ok<unknown>();
  return context;
}

describe('AjvSchemaRegistry', () => {
  it('compiles and returns a validator for a registered request class', () => {
    const validate = AjvSchemaRegistry.global.getValidator(ClientRequest);
    expect(validate).toBeDefined();
    expect(validate!({ name: 'ok' })).toBe(true);
    expect(validate!({ name: 'way-too-long-a-name' })).toBe(false);
  });

  it('returns undefined for an unregistered request class', () => {
    expect(AjvSchemaRegistry.global.getValidator(UnvalidatedRequest)).toBeUndefined();
  });

  it('exposes the raw registered schema for the JSON-Schema source', () => {
    expect(AjvSchemaRegistry.global.getSchema(ClientRequest)).toMatchObject({ type: 'object' });
  });
});

describe('formatValidationErrors', () => {
  it('carries the failing value JSON Pointer as field and the keyword as code', () => {
    const validate = AjvSchemaRegistry.global.getValidator(ClientRequest)!;
    validate({ name: 'way-too-long-a-name' });

    const errors = formatValidationErrors(validate.errors);
    expect(errors).toHaveLength(1);
    // The pointer is already in wire form, so it travels as `field` rather than being glued into
    // the message - the same shape .NET's JsonSchemaValidationErrors.Format produces.
    expect(errors[0].field).toBe('/name');
    expect(errors[0].code).toBe('maxLength');
    expect(errors[0].message).not.toContain('/name');
  });

  it('leaves field unset for a root-level failure', () => {
    const validate = AjvSchemaRegistry.global.getValidator(ClientRequest)!;
    validate('not-an-object');

    const errors = formatValidationErrors(validate.errors);
    expect(errors[0].field).toBeUndefined();
    expect(errors[0].code).toBe('type');
  });

  it('de-duplicates identical failures', () => {
    const duplicated = [
      { instancePath: '/name', keyword: 'maxLength', message: 'too long' },
      { instancePath: '/name', keyword: 'maxLength', message: 'too long' },
    ] as unknown as Parameters<typeof formatValidationErrors>[0];

    expect(formatValidationErrors(duplicated)).toHaveLength(1);
  });

  it('falls back to a generic message when there is no detail', () => {
    expect(formatValidationErrors(null)).toEqual([{ message: 'Request does not match the schema' }]);
    expect(formatValidationErrors([])).toEqual([{ message: 'Request does not match the schema' }]);
  });
});

describe('formatValidationMessages', () => {
  it('still renders the flat prose for a caller that wants one line per failure', () => {
    const validate = AjvSchemaRegistry.global.getValidator(ClientRequest)!;
    validate({ name: 'way-too-long-a-name' });

    expect(formatValidationMessages(validate.errors)[0]).toMatch(/^\/name: /);
  });
});

describe('ValidationClientMiddleware', () => {
  it('calls next for a valid message (response untouched)', async () => {
    const middleware = new ValidationClientMiddleware<ClientRequest, unknown>();
    const valid = new ClientRequest();
    valid.name = 'foo';
    const context = contextFor(valid);

    let nextCalled = false;
    await middleware.handleAsync(context, () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(true);
    expect(context.response.status).toBe(BenzeneResultStatus.ok);
  });

  it('short-circuits with ValidationError for an invalid message', async () => {
    const middleware = new ValidationClientMiddleware<ClientRequest, unknown>();
    const invalid = new ClientRequest();
    invalid.name = 'foo-bar-foo-bar';
    const context = contextFor(invalid);

    let nextCalled = false;
    await middleware.handleAsync(context, () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(false);
    expect(context.response.status).toBe(BenzeneResultStatus.validationError);
    expect(context.response.isSuccessful).toBe(false);
  });

  it('passes through when no schema is registered for the message type', async () => {
    const middleware = new ValidationClientMiddleware<UnvalidatedRequest, unknown>();
    const context = contextFor(new UnvalidatedRequest());

    let nextCalled = false;
    await middleware.handleAsync(context, () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(true);
    expect(context.response.status).toBe(BenzeneResultStatus.ok);
  });
});
