/** Port of Benzene.Mesh.Aws.Lambda.AwsLambdaMeshServiceDispatcher. */
import { InvocationType } from '@aws-sdk/client-lambda';
import { BenzeneMessageClientResponse } from '@benzenejs/clients';
import { BenzeneMessageClientRequest, IAwsLambdaClient } from '@benzenejs/clients-aws-lambda';
import { MeshServiceRegistryEntry, MeshServiceSource } from '@benzenejs/mesh-contracts';
import { IMeshServiceDispatcher, MeshDispatchEnvelope, MeshDispatchResult } from '@benzenejs/mesh-dispatch';
import { resolveFunctionName } from './LambdaMeshServiceSource';
import { raceWithSignal } from './raceWithSignal';

/**
 * Dispatches to an AWS-Lambda service via a synchronous `RequestResponse` invoke - reusing the exact client
 * (`IAwsLambdaClient`) and `lambda:InvokeFunction` grant `LambdaMeshServiceSource` already uses to
 * interrogate each service, changing only the topic/body. Requires `sourceOptions["functionName"]`.
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

    const response = await raceWithSignal(
      this.client().sendMessageAsync<BenzeneMessageClientRequest, BenzeneMessageClientResponse>(
        request,
        functionName,
        InvocationType.RequestResponse,
      ),
      cancellationToken,
    );

    return new MeshDispatchResult(response.statusCode, response.body, response.headers);
  }
}
