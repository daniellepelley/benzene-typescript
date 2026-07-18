import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { BenzeneException } from '@benzene/core';
import { Context } from 'aws-lambda';
import { AwsEventStreamContext } from './AwsEventStream/AwsEventStreamContext';
import { IAwsLambdaEntryPoint } from './IAwsLambdaEntryPoint';

/**
 * Port of Benzene.Aws.Lambda.Core.AwsLambdaEntryPoint.
 *
 * The default `IAwsLambdaEntryPoint`: runs a middleware pipeline over an `AwsEventStreamContext` for
 * each Lambda invocation, then returns the context's `response`.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: the .NET original reads/writes payload streams and, since its
 * `AwsEventStreamContext.Response` is initialized to a `MemoryStream`, checks `Response != null`.
 * Node hands the handler an already-parsed event and expects a return value, so this port takes
 * `event: unknown`, returns `Promise<unknown>`, and — because `response` starts `undefined` — throws
 * when it is still `undefined` after the pipeline runs (no router recognized the event). The thrown
 * `BenzeneException` carries the SAME message as C#. C# `using var scope` maps to try/finally dispose.
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
      scope.dispose();
    }
  }

  dispose(): void {
    this.serviceResolverFactory?.dispose();
  }
}
