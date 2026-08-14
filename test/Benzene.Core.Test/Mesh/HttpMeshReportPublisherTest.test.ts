import { describe, expect, it } from 'vitest';
import { MeshServiceReport } from '@benzenejs/mesh-contracts';
import { HttpMeshReportPublisher, MeshReportingOptions } from '@benzenejs/mesh-reporting';

/**
 * Port of test/Benzene.Mesh.Test/HttpMeshReportPublisherTest.cs. The C# `CapturingHttpMessageHandler` +
 * `HttpClient` become a capturing stub `fetch` (`HttpClient` -> injectable `fetch`); a non-2xx response
 * throws (`EnsureSuccessStatusCode`).
 */

function capturingFetch(status: number): {
  fetchFn: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response('', { status }));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('HttpMeshReportPublisher', () => {
  it('PublishAsync_PostsReportJsonToIngestionUrl', async () => {
    const { fetchFn, calls } = capturingFetch(200);
    const publisher = new HttpMeshReportPublisher(
      new MeshReportingOptions('https://mesh.internal/mesh/report'),
      fetchFn,
    );
    const report = new MeshServiceReport('payments-fn', Date.now(), '{"info":{}}', undefined, undefined);

    await publisher.publishAsync(report);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://mesh.internal/mesh/report');
    const body = JSON.parse(calls[0]!.init.body as string) as { name: string };
    expect(body.name).toBe('payments-fn');
  });

  it('PublishAsync_NonSuccessResponse_Throws', async () => {
    const { fetchFn } = capturingFetch(500);
    const publisher = new HttpMeshReportPublisher(
      new MeshReportingOptions('https://mesh.internal/mesh/report'),
      fetchFn,
    );

    await expect(
      publisher.publishAsync(new MeshServiceReport('payments-fn', Date.now(), undefined, undefined, undefined)),
    ).rejects.toThrow();
  });
});
