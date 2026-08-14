import { IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { BenzeneException } from '@benzenejs/core';
import { Context } from 'aws-lambda';
import { AwsEventStreamContext } from './AwsEventStream/AwsEventStreamContext';
import { IAwsLambdaEntryPoint } from './IAwsLambdaEntryPoint';

/**
 * Port of Benzene.Aws.Lambda.Core.AwsLambdaEntryPoint.
 *
 * The default `IAwsLambdaEntryPoint`: runs a middleware pipeline over an `AwsEventStreamContext` for
 * each Lambda invocation, then returns the context's `response`.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: the .NET original registers a `Stream FunctionHandlerAsync(Stream,
 * ILambdaContext)` handler — the .NET Lambda runtime hands it the raw payload bytes and Benzene
 * deserializes/sniffs the stream per transport. The AWS **Node.js** runtime has no such stream mode: it
 * ALWAYS parses the invocation payload and passes the handler the already-parsed event
 * (`@types/aws-lambda`'s `Handler`: *"event = Parsed JSON data in the lambda request payload"*), and an
 * async handler *"return[s] a promise that resolves with the result payload"*. So this port takes
 * `event: unknown` (the parsed event), returns `Promise<unknown>` (the value the runtime serializes back),
 * and — because `response` starts `undefined` — throws when no router recognized the event. Each
 * transport router's `canHandle` does the sniffing the C# stream-deserialize did, on the parsed event's
 * shape (`eventSource`/`httpMethod`/`requestContext.http`/…). This is the only AWS-correct shape in Node;
 * see `AwsLambdaEntryPointContractTest`. The thrown `BenzeneException` carries the SAME message as C#.
 * C# `using var scope` maps to try/finally dispose. Wrap with `toLambdaHandler` for `export const handler`.
 */
export class AwsLambdaEntryPoint implements IAwsLambdaEntryPoint {
  constructor(
    private readonly app: IMiddlewarePipeline<AwsEventStreamContext>,
    private readonly serviceResolverFactory: IServiceResolverFactory,
  ) {}

  async functionHandlerAsync(event: unknown, lambdaContext: Context): Promise<unknown> {
    const scope = this.serviceResolverFactory.createScope();
    try {
      const context = new AwsEventStreamContext(event, lambdaContext);
      await this.app.handleAsync(context, scope);

      if (context.response !== undefined) {
        return context.response;
      }

      throw new BenzeneException(
        'The event type has not been recognized. It is possible that there isn\'t a pipeline set up that can handle this event type, or the JSON for the event is not complete, for instance the EventSource field is missing',
      );
    } finally {
      if (scope.disposeAsync) {
        await scope.disposeAsync();
      } else {
        scope.dispose();
      }
    }
  }

  dispose(): void {
    this.serviceResolverFactory?.dispose();
  }
}
