/** Port of Benzene.Mesh.Dispatch.HttpMeshServiceDispatcher. */
import { MeshServiceRegistryEntry, MeshServiceSource } from '@benzene/mesh-contracts';
import { MeshDispatchEnvelope, MeshDispatchResult } from './MeshDispatchEnvelope';
import { IMeshServiceDispatcher } from './IMeshServiceDispatcher';

/** The `SourceOptions` key overriding the invoke URL. */
export const InvokeUrlOption = 'invokeUrl';
const DefaultInvokePath = '/benzene-message';

/** A `fetch`-like function - the port of C# `HttpClient.PostAsync` (`HttpClient` -> injectable `fetch`). */
export type DispatchFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Dispatches to an HTTP-reachable service by POSTing the Benzene message envelope (`{ topic, headers, body }`)
 * to its wire-envelope endpoint. The endpoint URL comes from the entry's `sourceOptions["invokeUrl"]` when
 * present, otherwise derived from the entry's `specUrl` origin as `<origin>/benzene-message`.
 *
 * `HttpClient` -> an injectable `fetch` (default global `fetch`), the same adaptation as
 * `@benzene/health-checks-http`.
 */
export class HttpMeshServiceDispatcher implements IMeshServiceDispatcher {
  constructor(private readonly fetchFn: DispatchFetch = fetch) {}

  get key(): string {
    return MeshServiceSource.http;
  }

  async dispatchAsync(
    entry: MeshServiceRegistryEntry,
    envelope: MeshDispatchEnvelope,
    cancellationToken?: AbortSignal,
  ): Promise<MeshDispatchResult> {
    const url = resolveInvokeUrl(entry);
    const payload = JSON.stringify({
      topic: envelope.topic,
      headers: envelope.headers,
      body: envelope.body,
    });

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      signal: cancellationToken,
    });
    const responseBody = await response.text();

    // Pass back exactly what the service returned. A non-2xx HTTP status still carries a body.
    return new MeshDispatchResult(String(response.status), responseBody);
  }
}

function resolveInvokeUrl(entry: MeshServiceRegistryEntry): string {
  const explicitUrl = entry.sourceOptions?.[InvokeUrlOption];
  if (explicitUrl !== undefined && explicitUrl.trim() !== '') {
    return explicitUrl;
  }

  if (entry.specUrl.trim() === '') {
    throw new Error(
      `Mesh service "${entry.name}" has no "${InvokeUrlOption}" in sourceOptions and no specUrl to derive an invoke URL from.`,
    );
  }

  return new URL(entry.specUrl).origin + DefaultInvokePath;
}
