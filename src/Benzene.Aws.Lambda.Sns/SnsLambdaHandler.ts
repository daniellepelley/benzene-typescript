/** Port of Benzene.Aws.Lambda.Sns.SnsLambdaHandler. */
import { IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewareApplication } from '@benzenejs/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter, isSnsEvent } from '@benzenejs/aws-lambda-core';
import { SNSEvent } from 'aws-lambda';

/**
 * Routes AWS Lambda invocations whose event is an `SNSEvent` to the SNS middleware pipeline. Added to the
 * outer `AwsEventStreamContext` pipeline by `useSns`; it only handles the invocation if the event has
 * records whose source is `aws:sns`, otherwise it defers to the next middleware. SNS notifications don't
 * return a response — this is a fire-and-forget pattern.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: `tryExtractRequest` (inherited from `AwsLambdaMiddlewareRouter`)
 * returns the already-parsed `context.event` as `SNSEvent`; `canHandle` does the real discrimination on
 * `EventSource`. PascalCase mapping: `event.Records` (property stays PascalCase in `@types/aws-lambda`),
 * `records[0].EventSource` (the SNS record fields are PascalCase — see `SnsRecordContext`).
 *
 * FIRE-AND-FORGET / RESPONSE SENTINEL: C#'s `HandleFunction` writes no response; its
 * `AwsEventStreamContext.Response` is a pre-initialized `MemoryStream`, so the entry point's `Response !=
 * null` check still passes. This port's `AwsEventStreamContext.response` instead STARTS `undefined` and
 * that `undefined` is the entry point's "event not recognized" signal (see `AwsLambdaEntryPoint`). So a
 * handling fire-and-forget router must write a non-`undefined` value to record that it DID handle the
 * event; `null` is the natural "handled, no body" response the Lambda returns for SNS.
 */
export class SnsLambdaHandler extends AwsLambdaMiddlewareRouter<SNSEvent> {
  constructor(
    private readonly application: IMiddlewareApplication<SNSEvent>,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
  }

  /** True if the event has at least one record sourced from SNS. */
  protected canHandle(request: SNSEvent): boolean {
    return isSnsEvent(request);
  }

  /** Runs the SNS application (no response) and marks the event as handled via the null sentinel. */
  protected async handleFunction(
    request: SNSEvent,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    await this.application.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, null);
  }
}
