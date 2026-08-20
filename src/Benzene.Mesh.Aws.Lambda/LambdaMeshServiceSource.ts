/** Port of Benzene.Mesh.Aws.Lambda.LambdaMeshServiceSource. */
import { InvocationType } from '@aws-sdk/client-lambda';
import { context as otelContext, trace } from '@opentelemetry/api';
import { BenzeneMessageClientResponse } from '@benzenejs/clients';
import { BenzeneMessageClientRequest, IAwsLambdaClient } from '@benzenejs/clients-aws-lambda';
import { IMeshServiceSource } from '@benzenejs/mesh-aggregator';
import { MeshServiceRegistryEntry, MeshServiceSource } from '@benzenejs/mesh-contracts';
import { raceWithSignal } from './raceWithSignal';

// Deliberately hardcoded, not referencing the spec/health topic constants directly - keeps this adapter's
// dependency graph to just the mesh aggregator + the Lambda client + the AWS Lambda SDK. The
// "...MatchingBenzene..." tests pin these against the real constants so a future rename fails loudly here.
const SpecTopic = 'benzene:spec';
const HealthTopic = 'benzene:healthcheck';

/**
 * Fetches a service's spec/health via a synchronous AWS Lambda `RequestResponse` invoke, for services with
 * no public HTTP surface. Sends the literal topics `"benzene:spec"`/`"benzene:healthcheck"` - any service wired the normal
 * Benzene way already answers a direct Lambda invocation carrying either topic, with zero target-side changes.
 *
 * `IAwsLambdaClient` is taken lazily (a `() => IAwsLambdaClient` thunk): `MeshAggregator` resolves every
 * `IMeshServiceSource` eagerly at startup, so deferring the client's construction means a pure-HTTP mesh
 * never builds a Lambda client just to start. `Activity.Current` (W3C trace propagation) -> the active
 * OpenTelemetry span context; `Task.WaitAsync(ct)` -> {@link raceWithSignal}.
 */
export class LambdaMeshServiceSource implements IMeshServiceSource {
  /** The `MeshServiceRegistryEntry.sourceOptions` key naming the target Lambda function. */
  static readonly FunctionNameOption = 'functionName';

  private readonly client: () => IAwsLambdaClient;

  constructor(client: IAwsLambdaClient | (() => IAwsLambdaClient)) {
    this.client = typeof client === 'function' ? client : (): IAwsLambdaClient => client;
  }

  get key(): string {
    return MeshServiceSource.awsLambdaInvoke;
  }

  fetchSpecAsync(entry: MeshServiceRegistryEntry, cancellationToken?: AbortSignal): Promise<string> {
    return this.invokeAsync(entry, SpecTopic, '', cancellationToken);
  }

  fetchHealthAsync(entry: MeshServiceRegistryEntry, cancellationToken?: AbortSignal): Promise<string> {
    return this.invokeAsync(entry, HealthTopic, '', cancellationToken);
  }

  async tryFetchSpecAsync(
    entry: MeshServiceRegistryEntry,
    specType: string,
    cancellationToken?: AbortSignal,
  ): Promise<string | undefined> {
    // Same spec topic, but carrying a SpecRequest body selecting the type (e.g. asyncapi) - the empty-body
    // fetchSpecAsync invoke yields the default benzene spec.
    const body = JSON.stringify({ type: specType, format: 'json' });
    return this.invokeAsync(entry, SpecTopic, body, cancellationToken);
  }

  private async invokeAsync(
    entry: MeshServiceRegistryEntry,
    topic: string,
    body: string,
    cancellationToken?: AbortSignal,
  ): Promise<string> {
    const functionName = resolveFunctionName(entry);
    const request = new BenzeneMessageClientRequest(topic, buildTraceHeaders(), body);

    const response = await raceWithSignal(
      this.client().sendMessageAsync<BenzeneMessageClientRequest, BenzeneMessageClientResponse>(
        request,
        functionName,
        InvocationType.RequestResponse,
      ),
      cancellationToken,
    );

    return response.body;
  }
}

/**
 * Propagates the current W3C trace context onto the invoke so the target service continues THIS trace
 * instead of starting a disconnected root. C#'s `Activity.Current.Id` -> a `traceparent` built from the
 * active OpenTelemetry span context. No active span -> no headers, exactly as before.
 */
function buildTraceHeaders(): Record<string, string> {
  const spanContext = trace.getSpanContext(otelContext.active());
  if (spanContext !== undefined && /^[0-9a-f]{32}$/.test(spanContext.traceId) && spanContext.traceId !== '0'.repeat(32)) {
    const flags = (spanContext.traceFlags & 0xff).toString(16).padStart(2, '0');
    return { traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${flags}` };
  }
  return {};
}

export function resolveFunctionName(entry: MeshServiceRegistryEntry): string {
  const functionName = entry.sourceOptions?.[LambdaMeshServiceSource.FunctionNameOption];
  if (functionName !== undefined) {
    return functionName;
  }

  throw new Error(
    `Mesh service "${entry.name}" uses source "${MeshServiceSource.awsLambdaInvoke}" but has no ` +
      `"${LambdaMeshServiceSource.FunctionNameOption}" in sourceOptions.`,
  );
}
