/**
 * In-process stand-ins for the two Azure surfaces the mesh touches, so the discover-and-interrogate story
 * runs end-to-end with no cloud account — the Azure counterpart of `aws-lambda-mesh/src/localAwsEnvironment.ts`.
 *
 *  - `stubResourceLister` implements `IAzureResourceLister` (the seam `AzureArmResourceLister` normally
 *    fills over `@azure/arm-resources`) by answering a fixed resource list — so `AzureAppServiceDiscoveryProvider`'s
 *    real tag/region-filtering and URL-building logic runs unmodified, with no ARM SDK / subscription.
 *  - `listenHttpFunction` serves a built `AzureFunctionHost`'s `.httpFunction` over a REAL local HTTP
 *    server, so `HttpMeshServiceSource`'s genuine, un-mocked `fetch` calls reach it exactly as they would
 *    a deployed Function App — proving the interrogation path end-to-end.
 *
 * `AzureAppServiceDiscoveryProvider` always builds `https://` URLs (matching real Azure, which is always
 * TLS) — a local test therefore can't route ONE discovery pass straight into interrogation without a
 * TLS-terminating local server. This example's test instead verifies the two seams independently: a
 * discovery test asserts the stub-lister -> `AzureAppServiceDiscoveryProvider` URL-building (see
 * `AzureFunctionsMeshExampleTest.test.ts`'s "discovery" case), and an interrogation test builds a
 * `MeshServiceRegistry` directly against the `http://localhost:<port>` servers `listenHttpFunction`
 * starts. Together they cover exactly what `runMeshAggregation` covers in one hop for AWS Lambda (whose
 * discovery targets are plain ARNs, not TLS URLs) — real Azure deployment is always https end-to-end, so
 * this split is a test-only seam, not a behavioural gap.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpRequest } from '@azure/functions';
import type { AzureHttpFunction } from '@benzenejs/azure-function-http';
import { AzureResourceInfo, IAzureResourceLister } from '@benzenejs/mesh-discovery-azure';

/** An `IAzureResourceLister` that answers a fixed resource list — the in-process stand-in for ARM's `resources.list(...)`. */
export function stubResourceLister(resources: AzureResourceInfo[]): IAzureResourceLister {
  return {
    listWebAppsAsync: () => Promise.resolve(resources),
  };
}

/** A `benzene`-tagged Function App resource, as ARM would report it (the real `AzureArmResourceLister` never resolves `defaultHost` either — see its own source — so the provider always falls back to `{name}.azurewebsites.net`). */
export function taggedResource(name: string, extraTags: Record<string, string> = {}): AzureResourceInfo {
  return { name, location: 'westeurope', defaultHost: undefined, tags: { benzene: 'true', ...extraTags } };
}

export interface RunningFunctionHost {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Serves an `AzureFunctionHost`'s `.httpFunction` over a real, ephemeral-port local HTTP server —
 * translating a genuine Node HTTP request into the `@azure/functions` `HttpRequest` shape the handler
 * expects, and its `HttpResponseInit` result back into a real HTTP response.
 */
export function listenHttpFunction(httpFunction: AzureHttpFunction): Promise<RunningFunctionHost> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void handle().catch((err: unknown) => {
        res.statusCode = 500;
        res.end(String(err));
      });
    });

    async function handle(): Promise<void> {
      const body = Buffer.concat(chunks);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers[key] = value;
        }
      }

      const request = new HttpRequest({
        method: req.method ?? 'GET',
        url: `http://localhost${req.url ?? '/'}`,
        headers,
        body: body.length > 0 ? { bytes: body } : undefined,
      });

      const response = await httpFunction(request);
      res.statusCode = response.status ?? 200;
      const responseHeaders = (response.headers as Record<string, string> | undefined) ?? {};
      for (const [key, value] of Object.entries(responseHeaders)) {
        res.setHeader(key, value);
      }
      res.end(typeof response.body === 'string' ? response.body : '');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://localhost:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
