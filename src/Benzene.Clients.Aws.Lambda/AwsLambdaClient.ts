/** Port of Benzene.Clients.Aws.Lambda.AwsLambdaClient. */
import { InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { ISerializer } from '@benzene/abstractions';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { AwsLambdaFunctionErrorException } from './AwsLambdaFunctionErrorException';

/**
 * An `IAwsLambdaClient` implementation that invokes functions via the AWS Lambda SDK, serializing the
 * request and deserializing the response payload as JSON.
 *
 * `IAmazonLambda.InvokeAsync` -> `LambdaClient.send(new InvokeCommand(...))`; the request/response payloads
 * (`MemoryStream`/`Stream`) -> `Uint8Array` (`ISerializer.serializeToBytes`/a `TextDecoder`). An `Event`
 * invocation returns `undefined` (C# `default`).
 */
export class AwsLambdaClient {
  private readonly serializer: ISerializer;

  constructor(private readonly amazonLambda: LambdaClient) {
    this.serializer = new JsonSerializer();
  }

  async sendMessageAsync<TRequest, TResponse>(request: TRequest, functionName: string, invocationType: InvocationType): Promise<TResponse> {
    const lambdaResponse = await this.amazonLambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: invocationType,
        Payload: new TextEncoder().encode(this.serializer.serialize(request)),
      }),
    );

    if (invocationType === InvocationType.Event) {
      return undefined as TResponse;
    }

    // A RequestResponse invoke where the function threw returns HTTP 200 with FunctionError set and an error
    // object (not the normal output) as the payload. Surface that as a failure rather than mis-deserializing
    // the error object into TResponse.
    if (lambdaResponse.FunctionError !== undefined && lambdaResponse.FunctionError.length > 0) {
      throw new AwsLambdaFunctionErrorException(functionName, lambdaResponse.FunctionError, payloadToString(lambdaResponse.Payload));
    }

    return this.serializer.deserialize<TResponse>(payloadToString(lambdaResponse.Payload)) as TResponse;
  }
}

function payloadToString(payload: Uint8Array | undefined): string {
  return payload === undefined ? '' : new TextDecoder('utf-8').decode(payload);
}
