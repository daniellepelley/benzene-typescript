import { LambdaClient, ListFunctionsCommand, ListTagsCommand } from '@aws-sdk/client-lambda';
import { describe, expect, it } from 'vitest';
import { MeshDiscoveryFilter, MeshServiceSource } from '@benzenejs/mesh-contracts';
import { AwsLambdaDiscoveryProvider } from '@benzenejs/mesh-discovery-aws';

/**
 * Port of test/Benzene.Mesh.Test/Discovery/AwsLambdaDiscoveryProviderTest.cs. The Moq `IAmazonLambda`
 * becomes a stub `LambdaClient.send` that answers `ListFunctionsCommand` (paginated by `Marker`) and
 * `ListTagsCommand` (by function ARN) - the v3 command pattern in place of the interface methods.
 */
interface Fn {
  FunctionName: string;
  FunctionArn: string;
}

function fn(name: string): Fn {
  return { FunctionName: name, FunctionArn: `arn:aws:lambda:eu-west-1:1:function:${name}` };
}

interface Page {
  marker: string | undefined;
  nextMarker: string | undefined;
  names: string[];
}

function lambdaWith(functionsByName: Record<string, { fn: Fn; tags: Record<string, string> }>, pages: Page[]): LambdaClient {
  const send = (command: unknown): Promise<unknown> => {
    if (command instanceof ListFunctionsCommand) {
      const marker = command.input.Marker;
      const page = pages.find((p) => p.marker === marker)!;
      return Promise.resolve({ Functions: page.names.map((n) => functionsByName[n]!.fn), NextMarker: page.nextMarker });
    }
    if (command instanceof ListTagsCommand) {
      const arn = command.input.Resource;
      const match = Object.values(functionsByName).find((v) => v.fn.FunctionArn === arn)!;
      return Promise.resolve({ Tags: match.tags });
    }
    return Promise.reject(new Error('unexpected command'));
  };
  return { send } as unknown as LambdaClient;
}

describe('AwsLambdaDiscoveryProvider', () => {
  it('Discover_EmitsOnlyTaggedFunctions_AsAwsLambdaInvokeEntries', async () => {
    const functions = {
      orders: { fn: fn('orders'), tags: { benzene: 'true' } },
      unrelated: { fn: fn('unrelated'), tags: { team: 'x' } }, // no benzene tag
    };
    const lambda = lambdaWith(functions, [{ marker: undefined, nextMarker: undefined, names: ['orders', 'unrelated'] }]);

    const provider = new AwsLambdaDiscoveryProvider(lambda);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.name).toBe('orders');
    expect(entry.source).toBe(MeshServiceSource.awsLambdaInvoke);
    expect(entry.sourceOptions!['functionName']).toBe('orders');
  });

  it('Discover_FollowsPaginationMarker', async () => {
    const functions = {
      a: { fn: fn('a'), tags: { benzene: '1' } },
      b: { fn: fn('b'), tags: { benzene: '1' } },
    };
    const lambda = lambdaWith(functions, [
      { marker: undefined, nextMarker: 'page2', names: ['a'] },
      { marker: 'page2', nextMarker: undefined, names: ['b'] },
    ]);

    const provider = new AwsLambdaDiscoveryProvider(lambda);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries.map((e) => e.name).sort()).toEqual(['a', 'b']);
  });

  it('Discover_CarriesMeshPathHintTag', async () => {
    const functions = {
      orders: { fn: fn('orders'), tags: { benzene: 'true', 'benzene:mesh-path': '/custom/mesh' } },
    };
    const lambda = lambdaWith(functions, [{ marker: undefined, nextMarker: undefined, names: ['orders'] }]);

    const provider = new AwsLambdaDiscoveryProvider(lambda);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries).toHaveLength(1);
    expect(entries[0]!.sourceOptions!['meshPath']).toBe('/custom/mesh');
  });

  it('Discover_ValuedTagFilter_ExcludesNonMatching', async () => {
    const functions = {
      'prod-svc': { fn: fn('prod-svc'), tags: { benzene: 'prod' } },
      'dev-svc': { fn: fn('dev-svc'), tags: { benzene: 'dev' } },
    };
    const lambda = lambdaWith(functions, [{ marker: undefined, nextMarker: undefined, names: ['prod-svc', 'dev-svc'] }]);

    const provider = new AwsLambdaDiscoveryProvider(lambda);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter({ benzene: 'prod' }));

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('prod-svc');
  });
});
