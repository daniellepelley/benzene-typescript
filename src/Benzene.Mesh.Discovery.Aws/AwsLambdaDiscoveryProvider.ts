/** Port of Benzene.Mesh.Discovery.Aws.AwsLambdaDiscoveryProvider. */
import { FunctionConfiguration, LambdaClient, ListFunctionsCommand, ListTagsCommand } from '@aws-sdk/client-lambda';
import { IMeshDiscoveryProvider, MeshDiscoveryFilter, MeshServiceRegistryEntry, MeshServiceSource } from '@benzenejs/mesh-contracts';

/**
 * Upper bound on concurrent `ListTags` calls during discovery. Keeps a large account from firing hundreds of
 * tag reads at once and hitting the Lambda control-plane's request-rate limit, while still collapsing the
 * per-function reads into a handful of round-trips.
 */
const MaxConcurrentTagReads = 8;

/**
 * Discovers Benzene services by enumerating the AWS Lambda functions in the account (paginated
 * `ListFunctions`), reading each function's tags (`ListTags`), keeping those that match the
 * `MeshDiscoveryFilter` (by default, carry the `benzene` tag), and emitting a registry entry bound to the
 * AWS-Lambda-Invoke interrogation source (`MeshServiceSource.awsLambdaInvoke`) so a `LambdaMeshServiceSource`
 * interrogates each without any HTTP surface.
 *
 * `AWSSDK.Lambda`/`IAmazonLambda` -> `@aws-sdk/client-lambda`'s `LambdaClient` + the v3 command pattern (the
 * C# test mocked the SDK client, so the port takes the client directly rather than adding a seam). IAM:
 * `lambda:ListFunctions`, `lambda:ListTags`, and `lambda:InvokeFunction` (for the later interrogation). An
 * optional `benzene:mesh-path` tag is carried into `sourceOptions` for a non-default descriptor path.
 */
export class AwsLambdaDiscoveryProvider implements IMeshDiscoveryProvider {
  /** The tag whose value (when present) overrides the mesh descriptor path for a service. */
  static readonly MeshPathTag = 'benzene:mesh-path';

  constructor(private readonly lambda: LambdaClient) {}

  get key(): string {
    return MeshServiceSource.awsLambdaInvoke;
  }

  async discoverAsync(
    filter: MeshDiscoveryFilter,
    cancellationToken?: AbortSignal,
  ): Promise<readonly MeshServiceRegistryEntry[]> {
    // Enumerate every function first (paginated), then read their tags concurrently (bounded), so discovery
    // doesn't cost N sequential round-trips across the whole account.
    const functions: FunctionConfiguration[] = [];
    let marker: string | undefined;

    do {
      const response = await this.lambda.send(new ListFunctionsCommand({ Marker: marker }), { abortSignal: cancellationToken });
      if (response.Functions !== undefined) {
        functions.push(...response.Functions);
      }
      marker = response.NextMarker;
    } while (marker !== undefined && marker.length > 0);

    // Order-preserving bounded-concurrency tag reads (the port of the SemaphoreSlim + ordered Task.WhenAll),
    // so the discovered registry is stable across runs regardless of which tag read completes first.
    const tagged = await mapWithConcurrency(functions, MaxConcurrentTagReads, async (fn) => {
      const tagsResponse = await this.lambda.send(new ListTagsCommand({ Resource: fn.FunctionArn }), { abortSignal: cancellationToken });
      return { fn, tags: tagsResponse.Tags ?? {} };
    });

    const entries: MeshServiceRegistryEntry[] = [];
    for (const { fn, tags } of tagged) {
      if (!filter.matches(tags)) {
        continue;
      }

      const functionName = fn.FunctionName ?? '';
      const options: Record<string, string> = { functionName };
      const meshPath = tags[AwsLambdaDiscoveryProvider.MeshPathTag];
      if (meshPath !== undefined && meshPath.trim().length > 0) {
        options['meshPath'] = meshPath;
      }

      entries.push(new MeshServiceRegistryEntry(functionName, '', '', MeshServiceSource.awsLambdaInvoke, options));
    }

    return entries;
  }
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving input order in the result. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]!, index);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
