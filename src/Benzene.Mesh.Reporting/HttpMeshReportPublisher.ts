/** Port of Benzene.Mesh.Reporting.HttpMeshReportPublisher. */
import { IMeshReportPublisher, MeshServiceReport } from '@benzene/mesh-contracts';
import { MeshReportingOptions } from './MeshReportingOptions';

/** A `fetch`-like function - the port of C# `HttpClient.PostAsync` (`HttpClient` -> injectable `fetch`). */
export type ReportFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The HTTP-ingestion `IMeshReportPublisher` - POSTs the report as JSON to `MeshReportingOptions.ingestionUrl`
 * (an aggregator's ingestion endpoint), for a reporter that isn't colocated with the aggregator's storage.
 *
 * `HttpClient` -> an injectable `fetch` (default global `fetch`, the `@benzene/health-checks-http` pattern);
 * `EnsureSuccessStatusCode` -> throw on a non-2xx response. The report's fields are already camelCase, so
 * `JSON.stringify` matches C#'s camelCase `JsonSerializerOptions`.
 */
export class HttpMeshReportPublisher implements IMeshReportPublisher {
  constructor(
    private readonly options: MeshReportingOptions,
    private readonly fetchFn: ReportFetch = fetch,
  ) {}

  async publishAsync(report: MeshServiceReport): Promise<void> {
    const json = JSON.stringify(report);
    const response = await this.fetchFn(this.options.ingestionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json,
    });
    if (!response.ok) {
      throw new Error(`Mesh report POST to ${this.options.ingestionUrl} failed with status ${response.status}.`);
    }
  }
}
