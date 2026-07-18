import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BenzeneClientContext, IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { registerZodSchema, ValidationClientMiddleware } from '@benzene/zod';

/**
 * Unit tests for the client-side `ValidationClientMiddleware` — port of
 * Benzene.FluentValidation.ValidationClientMiddleware, ADAPTED to Zod. The schema is resolved from the
 * message instance's constructor (the erasure-driven client-side counterpart of C#'s
 * `IValidator<TRequest>` DI resolution).
 */

class ClientRequest {
  name: string | undefined;
}

registerZodSchema(ClientRequest, z.object({ name: z.string().max(10) }));

// A message type with no registered schema, to prove passthrough.
class UnvalidatedRequest {
  value: string | undefined;
}

function contextFor<TRequest>(message: TRequest): BenzeneClientContext<TRequest, unknown> {
  const request: IBenzeneClientRequest<TRequest> = { topic: 'topic', message, headers: {} };
  const context = new BenzeneClientContext<TRequest, unknown>(request);
  context.response = BenzeneResult.ok<unknown>();
  return context;
}

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
