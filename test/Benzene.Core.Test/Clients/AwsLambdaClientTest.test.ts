import { InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { describe, expect, it } from 'vitest';
import { AwsLambdaClient, AwsLambdaFunctionErrorException } from '@benzenejs/clients-aws-lambda';

/**
 * Port of test/Benzene.Core.Test/Aws/Client/Lambda/AwsLambdaClientTest.cs. The Moq `IAmazonLambda.InvokeAsync`
 * becomes a stub `LambdaClient.send` answering `InvokeCommand`; the response `Stream` payload -> a
 * `Uint8Array`. C# `default(TResponse)` for an `Event` invoke -> `undefined`.
 */
function toPayload(json: string): Uint8Array {
  return new TextEncoder().encode(json);
}

function lambdaReturning(response: { Payload?: Uint8Array; FunctionError?: string }, capture?: (input: unknown) => void): LambdaClient {
  const send = (command: unknown): Promise<unknown> => {
    if (command instanceof InvokeCommand) {
      capture?.(command.input);
      return Promise.resolve(response);
    }
    return Promise.reject(new Error('unexpected command'));
  };
  return { send } as unknown as LambdaClient;
}

describe('AwsLambdaClient', () => {
  it('SendMessageAsync_EventInvocation_ReturnsUndefined', async () => {
    let captured: { InvocationType?: string; FunctionName?: string } | undefined;
    const client = new AwsLambdaClient(lambdaReturning({}, (input) => (captured = input as typeof captured)));

    const result = await client.sendMessageAsync<string, string>('some-request', 'some-function', InvocationType.Event);

    expect(result).toBeUndefined();
    expect(captured!.InvocationType).toBe(InvocationType.Event);
    expect(captured!.FunctionName).toBe('some-function');
  });

  it('SendMessageAsync_RequestResponseInvocation_DeserializesPayload', async () => {
    const client = new AwsLambdaClient(lambdaReturning({ Payload: toPayload('"some-response"') }));

    const result = await client.sendMessageAsync<string, string>('some-request', 'some-function', InvocationType.RequestResponse);

    expect(result).toBe('some-response');
  });

  it('SendMessageAsync_FunctionErrorSet_ThrowsInsteadOfMisDeserializingTheErrorPayload', async () => {
    // A RequestResponse invoke where the function threw returns HTTP 200 with FunctionError set and an error
    // object as the payload - not the normal output. It must not be deserialized as TResponse.
    const client = new AwsLambdaClient(
      lambdaReturning({ FunctionError: 'Unhandled', Payload: toPayload('{"errorType":"NullReferenceException","errorMessage":"boom"}') }),
    );

    await expect(client.sendMessageAsync<string, string>('some-request', 'some-function', InvocationType.RequestResponse)).rejects.toMatchObject({
      name: 'AwsLambdaFunctionErrorException',
      functionName: 'some-function',
      functionError: 'Unhandled',
    });

    // And the error payload is carried through (checked via a caught instance).
    const error = await client
      .sendMessageAsync<string, string>('some-request', 'some-function', InvocationType.RequestResponse)
      .catch((e: unknown) => e as AwsLambdaFunctionErrorException);
    expect(error).toBeInstanceOf(AwsLambdaFunctionErrorException);
    expect((error as AwsLambdaFunctionErrorException).errorPayload).toContain('NullReferenceException');
  });
});
