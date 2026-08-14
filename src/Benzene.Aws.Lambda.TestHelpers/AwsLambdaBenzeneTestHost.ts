import { Context } from 'aws-lambda';
import { IMessageBuilder } from '@benzenejs/abstractions';
import { IAwsLambdaEntryPoint } from '@benzenejs/aws-lambda-core';
import { asBenzeneMessage, messageBuilder } from '@benzenejs/testing';

/**
 * Port of Benzene.Aws.Lambda.Core.TestHelpers.AwsLambdaBenzeneTestHost — an in-memory AWS Lambda test
 * host. Wraps a built {@link IAwsLambdaEntryPoint} and pushes native Lambda events (built by the `as*`
 * builders in this package) in through the front door, returning the transport's native response.
 *
 * IDIOM MAP: the .NET host takes/returns raw `Stream`s (the .NET Lambda runtime hands the handler an
 * unparsed byte stream); the Node runtime hands an already-parsed event and expects a value back, so —
 * exactly as `AwsLambdaEntryPoint` is adapted — `sendEventAsync` takes the parsed event and returns the
 * parsed response, with no stream (de)serialization dance. C# `IDisposable` → `dispose()`.
 */
export class AwsLambdaBenzeneTestHost {
  constructor(private readonly entryPoint: IAwsLambdaEntryPoint) {}

  /**
   * Sends a native Lambda event through the pipeline and returns the transport's native response
   * (`APIGatewayProxyResult`, an SQS batch response, …), typed by `TResponse`.
   * @param event The native Lambda event (typically built by an `as*` builder in this package).
   * @param context An optional Lambda context; a minimal fake is used when omitted.
   */
  async sendEventAsync<TResponse = unknown>(event: unknown, context?: Context): Promise<TResponse> {
    const lambdaContext = context ?? ({} as Context);
    return (await this.entryPoint.functionHandlerAsync(event, lambdaContext)) as TResponse;
  }

  /**
   * Sends a neutral Benzene message through the direct-invoke (benzene-message) surface and returns the
   * parsed response payload — no hand-forged event, no `JSON.parse(response.body)` at the call site.
   * Mirrors .NET's `host.SendBenzeneMessageAsync(...)`. The startup must wire `useBenzeneMessage` for
   * this path to resolve.
   *
   * @param message A pre-built `messageBuilder(...)`.
   * @param context An optional Lambda context.
   */
  sendBenzeneMessageAsync<TResponse = unknown>(message: IMessageBuilder<unknown>, context?: Context): Promise<TResponse>;
  /**
   * @param topic The reserved/domain topic to invoke (e.g. `'order:create'`, `'healthcheck'`).
   * @param payload The message payload (omit for a topic-only message).
   * @param context An optional Lambda context.
   */
  sendBenzeneMessageAsync<TResponse = unknown>(topic: string, payload?: unknown, context?: Context): Promise<TResponse>;
  async sendBenzeneMessageAsync<TResponse = unknown>(
    messageOrTopic: IMessageBuilder<unknown> | string,
    payloadOrContext?: unknown,
    maybeContext?: Context,
  ): Promise<TResponse> {
    let builder: IMessageBuilder<unknown>;
    let context: Context | undefined;
    if (typeof messageOrTopic === 'string') {
      builder =
        payloadOrContext === undefined ? messageBuilder(messageOrTopic) : messageBuilder(messageOrTopic, payloadOrContext);
      context = maybeContext;
    } else {
      builder = messageOrTopic;
      context = payloadOrContext as Context | undefined;
    }
    const response = await this.sendEventAsync<{ body?: string }>(asBenzeneMessage(builder), context);
    return (response.body === undefined || response.body === '' ? undefined : JSON.parse(response.body)) as TResponse;
  }

  /** Disposes the underlying entry point (its service resolver factory). Port of C# `Dispose`. */
  dispose(): void {
    this.entryPoint.dispose();
  }
}
