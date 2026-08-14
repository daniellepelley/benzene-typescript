import { describe, expect, it } from 'vitest';
import { IMessageHandlerContext } from '@benzenejs/abstractions-message-handlers';
import { DefaultValidationStatusMapper } from '@benzenejs/abstractions-validation';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import { getJsonSchemaValidator, registerJsonSchema, ValidationMiddleware } from '@benzenejs/ajv';

/**
 * Direct unit coverage for the handler-level {@link ValidationMiddleware} — the paths the end-to-end
 * pipeline test does not isolate: no schema registered → `next()`, and a null/undefined request →
 * the `"Request is null"` result (the documented handler-level substitute for C#'s pre-deserialization
 * `MissingBody`). The valid/invalid split is covered end-to-end by `AjvValidationsPipelineTest`.
 */

class Order {
  name: string | undefined;
}

registerJsonSchema(Order, {
  type: 'object',
  properties: { name: { type: 'string', maxLength: 5 } },
  required: ['name'],
});

function contextFor(request: unknown): IMessageHandlerContext<unknown, unknown> {
  return {
    topic: { id: 'orders', version: '' },
    handlerType: Order,
    request,
    response: BenzeneResult.ok<unknown>(),
  } as unknown as IMessageHandlerContext<unknown, unknown>;
}

const mapper = new DefaultValidationStatusMapper();

describe('ValidationMiddleware (handler-level)', () => {
  it('calls next when no validator is resolved (no schema registered)', async () => {
    const middleware = new ValidationMiddleware<unknown, unknown>(undefined, mapper);
    const context = contextFor(new Order());

    let nextCalled = false;
    await middleware.handleAsync(context, () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(true);
  });

  it('short-circuits with "Request is null" when the request is null/undefined', async () => {
    const validate = getJsonSchemaValidator(Order)!;
    const middleware = new ValidationMiddleware<unknown, unknown>(validate, mapper);
    const context = contextFor(undefined);

    let nextCalled = false;
    await middleware.handleAsync(context, () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(false);
    expect(context.response.status).toBe(BenzeneResultStatus.validationError);
    expect(context.response.errors).toContain('Request is null');
  });

  it('calls next for a valid request and leaves the response untouched', async () => {
    const validate = getJsonSchemaValidator(Order)!;
    const middleware = new ValidationMiddleware<unknown, unknown>(validate, mapper);
    const order = new Order();
    order.name = 'ok';
    const context = contextFor(order);

    let nextCalled = false;
    await middleware.handleAsync(context, () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(true);
    expect(context.response.status).toBe(BenzeneResultStatus.ok);
  });

  it('short-circuits with a per-error message for an invalid request', async () => {
    const validate = getJsonSchemaValidator(Order)!;
    const middleware = new ValidationMiddleware<unknown, unknown>(validate, mapper);
    const order = new Order();
    order.name = 'way-too-long';
    const context = contextFor(order);

    let nextCalled = false;
    await middleware.handleAsync(context, () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(false);
    expect(context.response.status).toBe(BenzeneResultStatus.validationError);
    expect(context.response.errors.some((e) => e.startsWith('/name'))).toBe(true);
  });
});
