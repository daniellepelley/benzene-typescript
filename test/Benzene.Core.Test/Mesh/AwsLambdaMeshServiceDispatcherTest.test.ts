import { InvocationType } from '@aws-sdk/client-lambda';
import { describe, expect, it } from 'vitest';
import { BenzeneMessageClientResponse } from '@benzenejs/clients';
import { AwsLambdaFunctionErrorException, IAwsLambdaClient } from '@benzenejs/clients-aws-lambda';
import { AwsLambdaMeshServiceDispatcher, LambdaMeshServiceSource } from '@benzenejs/mesh-aws-lambda';
import { MeshServiceRegistryEntry, MeshServiceSource } from '@benzenejs/mesh-contracts';
import { MeshDispatchEnvelope } from '@benzenejs/mesh-dispatch';
import { BenzeneResultStatus } from '@benzenejs/results';

/**
 * The Lambda mesh dispatcher's reply handling, and transport-bindings.md §1 (spec 1.1): an invoke that fails
 * before Lambda replies is a `timeout`/`service-unavailable` result, not an exception.
 */
function client(invoke: () => Promise<unknown>): IAwsLambdaClient {
  return {
    sendMessageAsync: <TRequest, TResponse>(_request: TRequest, _name: string, _type: InvocationType) =>
      invoke() as Promise<TResponse>,
  };
}

const entry = new MeshServiceRegistryEntry('orders', '', 'h', MeshServiceSource.awsLambdaInvoke, {
  [LambdaMeshServiceSource.FunctionNameOption]: 'orders-fn',
});
const envelope = new MeshDispatchEnvelope('order:create', {}, '{}');

describe('AwsLambdaMeshServiceDispatcher', () => {
  it("returns the function's response envelope", async () => {
    const dispatcher = new AwsLambdaMeshServiceDispatcher(
      client(() => Promise.resolve(new BenzeneMessageClientResponse('created', '{"id":"1"}', {}, true))),
    );
    const result = await dispatcher.dispatchAsync(entry, envelope);
    expect(result.statusCode).toBe('created');
    expect(result.body).toBe('{"id":"1"}');
  });

  it('a network failure is service-unavailable, not an exception', async () => {
    const dispatcher = new AwsLambdaMeshServiceDispatcher(
      client(() => Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND lambda.eu-west-1.amazonaws.com'), { code: 'ENOTFOUND' }))),
    );
    const result = await dispatcher.dispatchAsync(entry, envelope);
    expect(result.statusCode).toBe(BenzeneResultStatus.serviceUnavailable);
    expect(result.body).toMatch(/ENOTFOUND/);
  });

  it("an SDK timeout, or the caller's abort, is timeout", async () => {
    const sdkTimeout = new AwsLambdaMeshServiceDispatcher(
      client(() => Promise.reject(Object.assign(new Error('Connection timed out after 1000 ms'), { name: 'TimeoutError' }))),
    );
    expect((await sdkTimeout.dispatchAsync(entry, envelope)).statusCode).toBe(BenzeneResultStatus.timeout);

    const hangs = new AwsLambdaMeshServiceDispatcher(client(() => new Promise(() => undefined)));
    expect((await hangs.dispatchAsync(entry, envelope, AbortSignal.timeout(10))).statusCode).toBe(BenzeneResultStatus.timeout);
  });

  it('a function that threw is a reply, and still surfaces as AwsLambdaFunctionErrorException', async () => {
    const dispatcher = new AwsLambdaMeshServiceDispatcher(
      client(() => Promise.reject(new AwsLambdaFunctionErrorException('orders-fn', 'Unhandled', '{"errorMessage":"boom"}'))),
    );
    await expect(dispatcher.dispatchAsync(entry, envelope)).rejects.toBeInstanceOf(AwsLambdaFunctionErrorException);
  });
});
