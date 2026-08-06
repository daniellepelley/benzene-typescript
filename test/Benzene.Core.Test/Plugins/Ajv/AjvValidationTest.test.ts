import { describe, expect, it } from 'vitest';
import { BenzeneClientContext, IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  AjvSchemaRegistry,
  formatValidationErrors,
  registerJsonSchema,
  ValidationClientMiddleware,
} from '@benzene/ajv';

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
  it('prefixes each message with the failing value JSON Pointer and de-duplicates', () => {
    const validate = AjvSchemaRegistry.global.getValidator(ClientRequest)!;
    validate({ name: 'way-too-long-a-name' });

    const messages = formatValidationErrors(validate.errors);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^\/name: /);
  });

  it('falls back to a generic message when there is no detail', () => {
    expect(formatValidationErrors(null)).toEqual(['Request does not match the schema']);
    expect(formatValidationErrors([])).toEqual(['Request does not match the schema']);
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
