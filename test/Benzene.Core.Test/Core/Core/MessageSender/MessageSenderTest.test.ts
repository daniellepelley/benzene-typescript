import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, VoidResult } from '@benzene/abstractions';
import {
  IGetTopic,
  IMessageSender,
  IMessageSenderNoResponse,
} from '@benzene/abstractions-messages';
import { out } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * Port of the MessageSender scenarios exercised in Benzene.Core.Test (e.g.
 * Clients/Aws/Sqs/SqsMessageSenderBuilderTest.cs): register a sender over a client middleware
 * pipeline via `out(...).createSender(...)`, resolve it from the container, and send a request all
 * the way through the pipeline, asserting the result and topic routing. The SQS transport middleware
 * the C# test uses is not ported yet, so a hand-written terminal middleware plays the role of the
 * transport (it sets the client-context `Response`, exactly as a transport would).
 */

// An arbitrary outer transport context; `out` only needs the builder as an IRegisterDependency,
// matching the C# test's `new MiddlewarePipelineBuilder<AwsEventStreamContext>(...).Out(...)`.
class OuterContext {}

class ExampleRequestPayload {
  value = 'hello';
}

class ExampleResponsePayload {
  reference: string | undefined;
}

describe('MessageSenderTest', () => {
  it('CreateSender_SendsRequestThroughPipeline_AndReturnsResult', async () => {
    const container = new DefaultBenzeneServiceContainer();
    let observedTopic: string | undefined;
    let observedMessage: unknown;

    const outerBuilder = new MiddlewarePipelineBuilder<OuterContext>(container);
    out(outerBuilder, (senders) =>
      senders.createSender<ExampleRequestPayload>((client) =>
        client.useFn('send', async (context, next) => {
          observedTopic = context.request.topic;
          observedMessage = context.request.message;
          context.response = BenzeneResult.accepted<VoidResult>();
          await next();
        }),
      ),
    );

    const scope = container.createServiceResolverFactory().createScope();
    const sender = scope.getService(IMessageSenderNoResponse);
    const request = new ExampleRequestPayload();
    const result = await sender.sendMessageAsync(request);
    scope.dispose();

    expect(result).toBeDefined();
    expect(result.status).toBe(BenzeneResultStatus.accepted);
    // The request genuinely flowed through the pipeline as the client context's request.
    expect(observedMessage).toBe(request);
    // DefaultGetTopic yields an empty topic when none is registered.
    expect(observedTopic).toBe('');
  });

  it('CreateSender_UsesRegisteredGetTopic_ForTopicRouting', async () => {
    const container = new DefaultBenzeneServiceContainer();
    // Registering IGetTopic first means the sender's TryAddScoped(DefaultGetTopic) is a no-op.
    container.addScopedInstance(IGetTopic, { getTopic: () => 'my-topic' });
    let observedTopic: string | undefined;

    const outerBuilder = new MiddlewarePipelineBuilder<OuterContext>(container);
    out(outerBuilder, (senders) =>
      senders.createSender<ExampleRequestPayload>((client) =>
        client.useFn('send', async (context, next) => {
          observedTopic = context.request.topic;
          context.response = BenzeneResult.accepted<VoidResult>();
          await next();
        }),
      ),
    );

    const scope = container.createServiceResolverFactory().createScope();
    const sender = scope.getService(IMessageSenderNoResponse);
    await sender.sendMessageAsync(new ExampleRequestPayload());
    scope.dispose();

    expect(observedTopic).toBe('my-topic');
  });

  it('CreateSenderWithResponse_ReturnsTypedResponsePayload', async () => {
    const container = new DefaultBenzeneServiceContainer();

    const outerBuilder = new MiddlewarePipelineBuilder<OuterContext>(container);
    out(outerBuilder, (senders) =>
      senders.createSenderWithResponse<ExampleRequestPayload, ExampleResponsePayload>((client) =>
        client.useFn('send', async (context, next) => {
          const response = new ExampleResponsePayload();
          response.reference = `ref-${context.request.message.value}`;
          context.response = BenzeneResult.ok<ExampleResponsePayload>(response);
          await next();
        }),
      ),
    );

    const scope = container.createServiceResolverFactory().createScope();
    const sender = scope.getService(IMessageSender);
    const result = (await sender.sendMessageAsync(new ExampleRequestPayload())) as IBenzeneResultOf<ExampleResponsePayload>;
    scope.dispose();

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.payload).toEqual({ reference: 'ref-hello' });
  });
});
