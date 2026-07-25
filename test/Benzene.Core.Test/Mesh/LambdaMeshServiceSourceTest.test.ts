import { InvocationType } from '@aws-sdk/client-lambda';
import { context as otelContext, trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BenzeneMessageClientResponse } from '@benzene/clients';
import { BenzeneMessageClientRequest, IAwsLambdaClient } from '@benzene/clients-aws-lambda';
import { Constants as HealthCheckConstants } from '@benzene/health-checks';
import { LambdaMeshServiceSource } from '@benzene/mesh-aws-lambda';
import { MeshServiceRegistryEntry, MeshServiceSource } from '@benzene/mesh-contracts';
import { OtelHarness } from '../Diagnostics/otelHarness';

/**
 * Port of test/Benzene.Mesh.Test/LambdaMeshServiceSourceTest.cs. The Moq `IAwsLambdaClient` becomes a stub;
 * the C# `ActivitySource`/`Activity.Current` trace propagation -> the active OpenTelemetry span (via the
 * shared `OtelHarness`); `.WaitAsync(ct)` cancellation -> an `AbortSignal` raced by the source.
 */
function entry(functionName: string | undefined = 'orders-fn'): MeshServiceRegistryEntry {
  return new MeshServiceRegistryEntry(
    'orders-fn',
    'n/a',
    'n/a',
    MeshServiceSource.awsLambdaInvoke,
    functionName === undefined ? undefined : { [LambdaMeshServiceSource.FunctionNameOption]: functionName },
  );
}

function lambdaClient(
  response: BenzeneMessageClientResponse | 'never',
  capture?: (request: BenzeneMessageClientRequest) => void,
): IAwsLambdaClient {
  return {
    sendMessageAsync: <TRequest, TResponse>(request: TRequest, _functionName: string, _invocationType: InvocationType): Promise<TResponse> => {
      capture?.(request as unknown as BenzeneMessageClientRequest);
      if (response === 'never') {
        return new Promise<TResponse>(() => {
          /* never resolves */
        });
      }
      return Promise.resolve(response as unknown as TResponse);
    },
  };
}

describe('LambdaMeshServiceSource', () => {
  it('FetchSpecAsync_InvokesTargetFunction_ReturnsResponseBody', async () => {
    const client = lambdaClient(new BenzeneMessageClientResponse('ok', '{"info":{"title":"orders-api"}}'));
    const source = new LambdaMeshServiceSource(client);

    const result = await source.fetchSpecAsync(entry());

    expect(result).toBe('{"info":{"title":"orders-api"}}');
  });

  it('TryFetchSpecAsync_InvokesSpecTopicWithTheRequestedType_ReturnsBody', async () => {
    // The composite-AsyncAPI feature: the aggregator asks for the asyncapi spec, which invokes the same
    // "spec" topic but with a SpecRequest body selecting the type.
    let sent: BenzeneMessageClientRequest | undefined;
    const client = lambdaClient(new BenzeneMessageClientResponse('ok', '{"asyncapi":"2.0.0"}'), (r) => (sent = r));
    const source = new LambdaMeshServiceSource(client);

    const result = await source.tryFetchSpecAsync(entry(), 'asyncapi');

    expect(result).toBe('{"asyncapi":"2.0.0"}');
    expect(sent!.topic).toBe('spec');
    expect(sent!.body).toContain('asyncapi'); // the SpecRequest body carries type=asyncapi
  });

  it('FetchSpecAsync_SendsTheSharedSpecTopic', async () => {
    // Cross-check: the hardcoded topic literal (deliberately, to avoid pulling a schema package in) still
    // matches "spec". (The C# also cross-checks against Benzene.Schema.OpenApi.Constants.DefaultSpecTopic,
    // which isn't ported; the literal assertion is the equivalent regression guard.)
    let sentTopic: string | undefined;
    const client = lambdaClient(new BenzeneMessageClientResponse('ok', '{}'), (r) => (sentTopic = r.topic));
    const source = new LambdaMeshServiceSource(client);

    await source.fetchSpecAsync(entry());

    expect(sentTopic).toBe('spec');
  });

  it('FetchHealthAsync_SendsTheSharedHealthCheckTopic_MatchingBenzeneHealthChecks', async () => {
    let sentTopic: string | undefined;
    const client = lambdaClient(new BenzeneMessageClientResponse('ok', '{}'), (r) => (sentTopic = r.topic));
    const source = new LambdaMeshServiceSource(client);

    await source.fetchHealthAsync(entry());

    expect(sentTopic).toBe(HealthCheckConstants.defaultHealthCheckTopic);
  });

  it('FetchSpecAsync_NoFunctionNameInSourceOptions_Throws', async () => {
    const client = lambdaClient(new BenzeneMessageClientResponse('ok', '{}'));
    const source = new LambdaMeshServiceSource(client);

    // Build directly with no sourceOptions (not via `entry()`, whose default param replaces `undefined`).
    const noFunctionName = new MeshServiceRegistryEntry('orders-fn', 'n/a', 'n/a', MeshServiceSource.awsLambdaInvoke, undefined);
    await expect(source.fetchSpecAsync(noFunctionName)).rejects.toThrow(/functionName/);
  });

  it('FetchSpecAsync_CancelledToken_ThrowsEvenThoughUnderlyingClientHasNoCancellationSupport', async () => {
    // IAwsLambdaClient.sendMessageAsync has no cancellation parameter - this proves the raceWithSignal
    // wrapper still bounds the fetch from the caller's point of view.
    const client = lambdaClient('never');
    const source = new LambdaMeshServiceSource(client);

    const signal = AbortSignal.abort();

    await expect(source.fetchSpecAsync(entry(), signal)).rejects.toThrow();
  });

  describe('W3C trace propagation', () => {
    const harness = new OtelHarness();
    beforeEach(() => harness.start());
    afterEach(() => harness.stop());

    it('Invoke_PropagatesW3CTraceContext_SoTheTargetServiceContinuesTheTrace', async () => {
      // Without this, the invoke carries an empty header dict and the target's UseW3CTraceContext starts a
      // disconnected root trace, showing an opaque gap instead of a linked child span per service.
      let sent: BenzeneMessageClientRequest | undefined;
      const client = lambdaClient(new BenzeneMessageClientResponse('ok', '{}'), (r) => (sent = r));
      const source = new LambdaMeshServiceSource(client);

      const span = trace.getTracer('mesh-test-source').startSpan('mesh-aggregate');
      const spanContext = span.spanContext();
      await otelContext.with(trace.setSpan(otelContext.active(), span), () => source.fetchSpecAsync(entry()));
      span.end();

      expect(sent!.headers['traceparent']).not.toBeUndefined();
      const flags = (spanContext.traceFlags & 0xff).toString(16).padStart(2, '0');
      expect(sent!.headers['traceparent']).toBe(`00-${spanContext.traceId}-${spanContext.spanId}-${flags}`);
    });
  });
});
