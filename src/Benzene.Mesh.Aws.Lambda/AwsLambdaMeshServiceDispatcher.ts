/** Port of Benzene.Mesh.Aws.Lambda.AwsLambdaMeshServiceDispatcher. */
import { InvocationType } from '@aws-sdk/client-lambda';
import { BenzeneMessageClientResponse } from '@benzenejs/clients';
import { AwsLambdaFunctionErrorException, BenzeneMessageClientRequest, IAwsLambdaClient } from '@benzenejs/clients-aws-lambda';
import { MeshServiceRegistryEntry, MeshServiceSource } from '@benzenejs/mesh-contracts';
import {
  IMeshServiceDispatcher,
  MeshDispatchEnvelope,
  MeshDispatchResult,
  transportFailureDispatchResult,
} from '@benzenejs/mesh-dispatch';
import { resolveFunctionName } from './LambdaMeshServiceSource';
import { raceWithSignal } from './raceWithSignal';

/**
 * Dispatches to an AWS-Lambda service via a synchronous `RequestResponse` invoke - reusing the exact client
 * (`IAwsLambdaClient`) and `lambda:InvokeFunction` grant `LambdaMeshServiceSource` already uses to
 * interrogate each service, changing only the topic/body. Requires `sourceOptions["functionName"]`. An invoke
 * that fails before Lambda replies (a network error, an SDK timeout, the caller's abort) is a `timeout` or
 * `service-unavailable` result ({@link transportFailureDispatchResult}), not an exception; a function that
 * threw still surfaces as an `AwsLambdaFunctionErrorException`.
 */
export class AwsLambdaMeshServiceDispatcher implements IMeshServiceDispatcher {
  private readonly client: () => IAwsLambdaClient;

  constructor(client: IAwsLambdaClient | (() => IAwsLambdaClient)) {
    this.client = typeof client === 'function' ? client : (): IAwsLambdaClient => client;
  }

  get key(): string {
    return MeshServiceSource.awsLambdaInvoke;
  }

  async dispatchAsync(
    entry: MeshServiceRegistryEntry,
    envelope: MeshDispatchEnvelope,
    cancellationToken?: AbortSignal,
  ): Promise<MeshDispatchResult> {
    const functionName = resolveFunctionName(entry);
    const request = new BenzeneMessageClientRequest(envelope.topic, envelope.headers, envelope.body);

    let response: BenzeneMessageClientResponse;
    try {
      response = await raceWithSignal(
        this.client().sendMessageAsync<BenzeneMessageClientRequest, BenzeneMessageClientResponse>(
          request,
          functionName,
          InvocationType.RequestResponse,
        ),
        cancellationToken,
      );
    } catch (error) {
      // The function itself threw: Lambda replied (with a FunctionError), so this is not a pre-reply failure.
      if (error instanceof AwsLambdaFunctionErrorException) {
        throw error;
      }
      // Failed before any reply (transport-bindings §1): a `timeout`/`service-unavailable` result, not a throw.
      return transportFailureDispatchResult(error);
    }

    return new MeshDispatchResult(response.statusCode, response.body, response.headers);
  }
}
