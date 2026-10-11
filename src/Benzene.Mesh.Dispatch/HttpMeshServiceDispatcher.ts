/** Port of Benzene.Mesh.Dispatch.HttpMeshServiceDispatcher. */
import { MeshServiceRegistryEntry, MeshServiceSource } from '@benzenejs/mesh-contracts';
import { MeshDispatchEnvelope, MeshDispatchResult } from './MeshDispatchEnvelope';
import { IMeshServiceDispatcher } from './IMeshServiceDispatcher';

/** The `SourceOptions` key overriding the invoke URL. */
export const InvokeUrlOption = 'invokeUrl';
/** The default envelope path a service is invoked on: `/benzene/invoke` (design-principles §5.2). */
export const DefaultInvokePath = '/benzene/invoke';

/** A `fetch`-like function - the port of C# `HttpClient.PostAsync` (`HttpClient` -> injectable `fetch`). */
export type DispatchFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Dispatches to an HTTP-reachable service by POSTing the Benzene message envelope (`{ topic, headers, body }`)
 * to its wire-envelope endpoint. The endpoint URL comes from the entry's `sourceOptions["invokeUrl"]` when
 * present, otherwise derived from the entry's `specUrl` origin as `<origin>/benzene/invoke`.
 *
 * `HttpClient` -> an injectable `fetch` (default global `fetch`), the same adaptation as
 * `@benzenejs/health-checks-http`.
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

    // The envelope endpoint answers 200 for every envelope it processed, the outcome inside the envelope
    // (transport-bindings §1, D17), so the result is read from the body whatever the status. Only a body
    // that is not an envelope (a carrier failure, or a non-Benzene endpoint) falls back to the status line.
    const replied = tryParseResponseEnvelope(responseBody);
    return replied === undefined
      ? new MeshDispatchResult(String(response.status), responseBody)
      : new MeshDispatchResult(replied.statusCode, replied.body, replied.headers);
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

function tryParseResponseEnvelope(
  body: string,
): { statusCode: string; body: string | undefined; headers: Record<string, string> | undefined } | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { statusCode?: unknown }).statusCode !== 'string') {
      return undefined;
    }
    const envelope = parsed as { statusCode: string; body?: unknown; headers?: unknown };
    return {
      statusCode: envelope.statusCode,
      body: typeof envelope.body === 'string' ? envelope.body : undefined,
      headers:
        typeof envelope.headers === 'object' && envelope.headers !== null
          ? (envelope.headers as Record<string, string>)
          : undefined,
    };
  } catch {
    return undefined;
  }
}
