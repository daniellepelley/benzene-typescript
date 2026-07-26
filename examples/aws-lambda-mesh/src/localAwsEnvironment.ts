/**
 * An in-memory stand-in for the two AWS surfaces the mesh uses, so the whole discover → interrogate →
 * aggregate chain runs end-to-end in one process with no cloud account:
 *
 *  - `inMemoryLambdaClient` implements `IAwsLambdaClient` by routing a `sendMessageAsync(request, functionName)`
 *    straight to the target service's in-process Lambda `handler` (the same object AWS would invoke), so the
 *    mesh's `LambdaMeshServiceSource` interrogates a real Benzene service exactly as it would over a real
 *    `Invoke`.
 *  - `discoveryLambdaClient` stubs the `@aws-sdk/client-lambda` `LambdaClient` so `AwsLambdaDiscoveryProvider`'s
 *    `ListFunctions`/`ListTags` return the six services, each carrying the `benzene` discovery tag — the same
 *    v3-command stub shape the `AwsLambdaDiscoveryProviderTest` uses.
 */
import { Context, Handler } from 'aws-lambda';
import { InvocationType, LambdaClient, ListFunctionsCommand, ListTagsCommand } from '@aws-sdk/client-lambda';
import { IAwsLambdaClient } from '@benzene/clients-aws-lambda';

const fakeContext = {} as Context;

/** An `IAwsLambdaClient` that invokes in-process service handlers by function name. */
export function inMemoryLambdaClient(services: Record<string, Handler>): IAwsLambdaClient {
  return {
    async sendMessageAsync<TRequest, TResponse>(
      request: TRequest,
      functionName: string,
      invocationType: InvocationType,
    ): Promise<TResponse> {
      const handler = services[functionName];
      if (handler === undefined) {
        throw new Error(`No in-process Lambda registered for function '${functionName}'`);
      }
      // The request envelope ({ topic, headers, body }) IS the parsed Lambda event the service's
      // BenzeneMessage route consumes; pass it straight through (no over-the-wire serialization).
      const result = await Promise.resolve(
        (handler as (event: unknown, context: Context) => unknown)(request, fakeContext),
      );
      return (invocationType === InvocationType.Event ? undefined : result) as TResponse;
    },
  };
}

/** A stubbed `@aws-sdk/client-lambda` `LambdaClient` answering `ListFunctions` + `ListTags` for the given services. */
export function discoveryLambdaClient(functionNames: string[], tagKey = 'benzene'): LambdaClient {
  const functions = functionNames.map((name) => ({
    FunctionName: name,
    FunctionArn: `arn:aws:lambda:eu-west-1:000000000000:function:${name}`,
  }));

  const send = (command: unknown): Promise<unknown> => {
    if (command instanceof ListFunctionsCommand) {
      // Single page (no Marker): all functions, no NextMarker.
      return Promise.resolve({ Functions: functions, NextMarker: undefined });
    }
    if (command instanceof ListTagsCommand) {
      const arn = command.input.Resource;
      const match = functions.find((f) => f.FunctionArn === arn);
      // Every service carries the discovery tag; the mesh function itself would be untagged (not modelled here).
      return Promise.resolve({ Tags: match !== undefined ? { [tagKey]: 'true' } : {} });
    }
    return Promise.reject(new Error('unexpected Lambda command'));
  };

  return { send } as unknown as LambdaClient;
}
