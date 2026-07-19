/** Port of Benzene.Aws.Lambda.S3.S3LambdaHandler. */
import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewareApplication } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter } from '@benzene/aws-lambda-core';
import { S3Event } from 'aws-lambda';

/**
 * Routes AWS Lambda invocations whose event is an `S3Event` to the S3 middleware pipeline. Added to the
 * outer `AwsEventStreamContext` pipeline by `useS3`; it only handles the invocation if the event has
 * records whose source is `aws:s3`, otherwise it defers to the next middleware. S3 event notifications
 * don't return a response — this is a fire-and-forget pattern.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: `tryExtractRequest` (inherited from `AwsLambdaMiddlewareRouter`)
 * returns the already-parsed `context.event` as `S3Event`; `canHandle` does the real discrimination on
 * `eventSource`. Field mapping: `event.Records` stays PascalCase; `records[0].eventSource` is camelCase.
 *
 * FIRE-AND-FORGET / RESPONSE SENTINEL: C#'s `HandleFunction` writes no response (its
 * `AwsEventStreamContext.Response` is a pre-initialized `MemoryStream`, so the entry point's `Response !=
 * null` check still passes). This port's `AwsEventStreamContext.response` instead STARTS `undefined`, and
 * that `undefined` is the entry point's "event not recognized" signal, so a handling fire-and-forget
 * router must write a non-`undefined` value; `null` is the natural "handled, no body" response — exactly
 * as `SnsLambdaHandler` does.
 */
export class S3LambdaHandler extends AwsLambdaMiddlewareRouter<S3Event> {
  constructor(
    private readonly application: IMiddlewareApplication<S3Event>,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
  }

  /** True if the event has at least one record sourced from S3. */
  protected canHandle(request: S3Event): boolean {
    return (
      request?.Records !== undefined &&
      request.Records.length > 0 &&
      request.Records[0].eventSource === 'aws:s3'
    );
  }

  /** Runs the S3 application (no response) and marks the event as handled via the null sentinel. */
  protected async handleFunction(
    request: S3Event,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    await this.application.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, null);
  }
}
