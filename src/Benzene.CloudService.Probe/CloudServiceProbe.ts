/** Port of Benzene.CloudService.Probe.CloudServiceProbe. */
import { CloudServiceProbeOptions } from './CloudServiceProbeOptions';
import {
  CloudServiceProbeReport,
  CloudServiceProbeRequirement,
  CloudServiceProbeVerdict,
} from './CloudServiceProbeReport';

/**
 * A `fetch`-like function. Port of the role played by .NET `HttpClient` (HttpClient -> fetch, as in
 * `@benzene/health-checks-http`); the C# `HttpClient.BaseAddress` becomes the `baseUrl` argument.
 */
export type ProbeFetch = (url: string, init?: RequestInit) => Promise<Response>;

const HealthDescription = 'Health checks';
const InvokeDescription = 'Wire-envelope invocability';
const SpecDescription = 'Derived spec';
const MeshDescription = 'Mesh service-side feeds (observable half - see reason)';

const HealthcheckEnvelope = '{"topic":"healthcheck","headers":{},"body":"{}"}';
const MeshEnvelope = '{"topic":"mesh","headers":{},"body":"{}"}';

interface HttpResult {
  reached: boolean;
  status?: number;
  body?: string;
  failureReason?: string;
}

interface ProbeOutcome {
  requirement: CloudServiceProbeRequirement;
  reached: boolean;
  topics?: unknown[];
}

/**
 * Runs an external, black-box conformance probe against a live Benzene Cloud Service, asserting R1-R8's
 * observable surfaces from outside - health response shape, envelope round-trip, spec and descriptor
 * presence, default paths - over real HTTP, without relying on anything the service says about itself.
 * Port of Benzene.CloudService.Probe.CloudServiceProbe (a static class -> a const object).
 */
export const CloudServiceProbe = {
  /**
   * Probes the service at `baseUrl` and returns a tri-state assessment of R1-R8. Never throws for an
   * unreachable or non-conformant service - unreachability and shape mismatches are reported as verdicts,
   * not exceptions. (An externally-requested `signal` abort does propagate, matching the C# `ct` behaviour.)
   */
  async runAsync(
    baseUrl: string,
    options: CloudServiceProbeOptions = new CloudServiceProbeOptions(),
    fetchFn: ProbeFetch = fetch,
    signal?: AbortSignal,
  ): Promise<CloudServiceProbeReport> {
    const health = await probeHealthAsync(baseUrl, options, fetchFn, signal);
    const invoke = await probeInvokeAsync(baseUrl, options, fetchFn, signal);
    const spec = await probeSpecAsync(baseUrl, options, fetchFn, signal);
    const mesh = await probeMeshAsync(baseUrl, options, fetchFn, signal);

    const requirements: CloudServiceProbeRequirement[] = [
      evaluateR1(health, invoke, spec, mesh),
      evaluateR2(mesh),
      health.requirement,
      invoke.requirement,
      spec.requirement,
      mesh.requirement,
      evaluateR7(options, health, invoke, spec, mesh),
      evaluateR8(options, invoke, mesh),
    ];

    return new CloudServiceProbeReport(requirements);
  },
};

// ---- R3: GET the health path; satisfied iff 200 OR 503 with a boolean isHealthy field. ----
async function probeHealthAsync(
  baseUrl: string,
  options: CloudServiceProbeOptions,
  fetchFn: ProbeFetch,
  signal: AbortSignal | undefined,
): Promise<ProbeOutcome> {
  const r = await getAsync(baseUrl, options.healthPath, fetchFn, signal);
  if (!r.reached) {
    return outcome('R3', HealthDescription, CloudServiceProbeVerdict.NotSatisfied,
      `GET ${options.healthPath} did not reach the service: ${r.failureReason}`, false);
  }
  // A conformant service returns 200 when healthy and 503 when unhealthy - both carry the same
  // health-report body. Runtime degradation is not a conformance failure, so accept either.
  if (r.status !== 200 && r.status !== 503) {
    return outcome('R3', HealthDescription, CloudServiceProbeVerdict.NotSatisfied,
      `GET ${options.healthPath} returned ${r.status}, expected 200 or 503`, true);
  }
  if (!tryGetBoolField(r.body, 'isHealthy')) {
    return outcome('R3', HealthDescription, CloudServiceProbeVerdict.NotSatisfied,
      `${r.status} response at ${options.healthPath} did not have a boolean 'isHealthy' field (wire-contracts.md §5)`, true);
  }
  return outcome('R3', HealthDescription, CloudServiceProbeVerdict.Satisfied,
    `GET ${options.healthPath} returned ${r.status} with a boolean 'isHealthy' field`, true);
}

// ---- R4: POST a synthetic envelope; satisfied iff 200 with the {statusCode, headers, body} shape. ----
async function probeInvokeAsync(
  baseUrl: string,
  options: CloudServiceProbeOptions,
  fetchFn: ProbeFetch,
  signal: AbortSignal | undefined,
): Promise<ProbeOutcome> {
  const r = await postAsync(baseUrl, options.invokePath, HealthcheckEnvelope, options.sendTraceParentProbe, fetchFn, signal);
  if (!r.reached) {
    return outcome('R4', InvokeDescription, CloudServiceProbeVerdict.NotSatisfied,
      `POST ${options.invokePath} did not reach the service: ${r.failureReason}`, false);
  }
  if (r.status !== 200) {
    return outcome('R4', InvokeDescription, CloudServiceProbeVerdict.NotSatisfied,
      `POST ${options.invokePath} with a synthetic envelope returned ${r.status}, expected 200`, true);
  }
  const envelope = tryParseEnvelopeResponse(r.body);
  if (!envelope.ok) {
    return outcome('R4', InvokeDescription, CloudServiceProbeVerdict.NotSatisfied,
      `200 response at ${options.invokePath} did not have the {statusCode, headers, body} envelope shape (wire-contracts.md §1.2): ${envelope.reason}`, true);
  }
  return outcome('R4', InvokeDescription, CloudServiceProbeVerdict.Satisfied,
    `POST ${options.invokePath} with a synthetic envelope round-tripped a valid {statusCode, headers, body} response`, true);
}

// ---- R5: GET the spec path; satisfied iff 200 with a non-empty JSON object. ----
async function probeSpecAsync(
  baseUrl: string,
  options: CloudServiceProbeOptions,
  fetchFn: ProbeFetch,
  signal: AbortSignal | undefined,
): Promise<ProbeOutcome> {
  const r = await getAsync(baseUrl, options.specPath, fetchFn, signal);
  if (!r.reached) {
    return outcome('R5', SpecDescription, CloudServiceProbeVerdict.NotSatisfied,
      `GET ${options.specPath} did not reach the service: ${r.failureReason}`, false);
  }
  if (r.status !== 200) {
    return outcome('R5', SpecDescription, CloudServiceProbeVerdict.NotSatisfied,
      `GET ${options.specPath} returned ${r.status}, expected 200`, true);
  }
  if (!tryParseNonEmptyObject(r.body)) {
    return outcome('R5', SpecDescription, CloudServiceProbeVerdict.NotSatisfied,
      `200 response at ${options.specPath} did not parse as a non-empty JSON object. The profile does not mandate a specific spec format (OpenAPI, AsyncAPI, or Benzene's own), only that a real derived document is there`, true);
  }
  return outcome('R5', SpecDescription, CloudServiceProbeVerdict.Satisfied,
    `GET ${options.specPath} returned 200 with a non-empty JSON object body`, true);
}

// ---- R6 (observable half only): POST topic "mesh"; satisfied iff 200 envelope wraps a descriptor with a non-empty "service". ----
async function probeMeshAsync(
  baseUrl: string,
  options: CloudServiceProbeOptions,
  fetchFn: ProbeFetch,
  signal: AbortSignal | undefined,
): Promise<ProbeOutcome> {
  const caveat =
    'Registration (mesh:register) and heartbeat (mesh:heartbeat) delivery to a collector cannot be observed ' +
    'by probing the service alone, so that half of R6 stays unverified even when the descriptor endpoint ' +
    'itself checks out - a passing descriptor check does not imply the whole of R6.';

  const r = await postAsync(baseUrl, options.invokePath, MeshEnvelope, options.sendTraceParentProbe, fetchFn, signal);
  if (!r.reached) {
    return outcome('R6', MeshDescription, CloudServiceProbeVerdict.NotSatisfied,
      `POST ${options.invokePath} with topic 'mesh' did not reach the service: ${r.failureReason}. ${caveat}`, false);
  }
  if (r.status !== 200) {
    return outcome('R6', MeshDescription, CloudServiceProbeVerdict.NotSatisfied,
      `POST ${options.invokePath} with topic 'mesh' returned ${r.status}, expected 200 (the reserved mesh topic does not appear to be served). ${caveat}`, true);
  }
  const envelope = tryParseEnvelopeResponse(r.body);
  if (!envelope.ok) {
    return outcome('R6', MeshDescription, CloudServiceProbeVerdict.NotSatisfied,
      `200 response to the 'mesh' topic did not have the {statusCode, headers, body} envelope shape (wire-contracts.md §1.2): ${envelope.reason}. ${caveat}`, true);
  }
  const descriptor = tryParseDescriptor(envelope.innerBody);
  if (!descriptor.ok) {
    return outcome('R6', MeshDescription, CloudServiceProbeVerdict.NotSatisfied,
      `200 response to the 'mesh' topic did not parse as a descriptor with a non-empty 'service' field (mesh.md §2): ${descriptor.reason}. ${caveat}`, true);
  }

  const topics = Array.isArray(descriptor.descriptor.topics) ? (descriptor.descriptor.topics as unknown[]) : undefined;
  return {
    requirement: new CloudServiceProbeRequirement('R6', MeshDescription, CloudServiceProbeVerdict.Satisfied,
      `the reserved 'mesh' topic served a descriptor for service '${String(descriptor.descriptor.service)}' - the observable half of R6 checks out. ${caveat}`),
    reached: true,
    topics,
  };
}

// ---- R1: inferential - satisfied iff anything responded at all. ----
function evaluateR1(health: ProbeOutcome, invoke: ProbeOutcome, spec: ProbeOutcome, mesh: ProbeOutcome): CloudServiceProbeRequirement {
  const description = 'Hosted middleware pipeline';
  const anyReached = health.reached || invoke.reached || spec.reached || mesh.reached;
  return anyReached
    ? new CloudServiceProbeRequirement('R1', description, CloudServiceProbeVerdict.Satisfied,
        'at least one probed surface responded over HTTP, which proves a hosted pipeline exists behind a transport binding - an in-process-only pipeline would have nothing for this probe to reach')
    : new CloudServiceProbeRequirement('R1', description, CloudServiceProbeVerdict.NotSatisfied,
        'none of the health, invoke, spec, or mesh surfaces responded at all; no hosted pipeline was reachable at the configured base address');
}

// ---- R2: inferential from R6's descriptor topics only. ----
function evaluateR2(mesh: ProbeOutcome): CloudServiceProbeRequirement {
  const description = 'Message handlers via the registry';
  if (mesh.requirement.verdict !== CloudServiceProbeVerdict.Satisfied) {
    return new CloudServiceProbeRequirement('R2', description, CloudServiceProbeVerdict.Inconclusive,
      'no reachable mesh descriptor to read registered topics from, and the profile does not mandate a spec document format, so topic counts can\'t be read from the spec surface either - absence of evidence isn\'t evidence of absence');
  }
  if (mesh.topics !== undefined && mesh.topics.length > 0) {
    return new CloudServiceProbeRequirement('R2', description, CloudServiceProbeVerdict.Satisfied,
      `the mesh descriptor lists ${mesh.topics.length} registered topic(s) (mesh.md §2), which can only be populated from the handler registry`);
  }
  return new CloudServiceProbeRequirement('R2', description, CloudServiceProbeVerdict.Inconclusive,
    'the mesh descriptor is reachable but lists no topics; a service can legitimately have zero handlers registered so far - absence of evidence isn\'t evidence of absence');
}

// ---- R7: only assessable when the probe itself used the defaults. ----
function evaluateR7(
  options: CloudServiceProbeOptions,
  health: ProbeOutcome,
  invoke: ProbeOutcome,
  spec: ProbeOutcome,
  mesh: ProbeOutcome,
): CloudServiceProbeRequirement {
  const description = 'Default service standard paths';
  if (!options.usesDefaultPaths) {
    return new CloudServiceProbeRequirement('R7', description, CloudServiceProbeVerdict.Inconclusive,
      'the probe was configured with non-default path(s), so it cannot tell whether the service itself defaults to /benzene/invoke, /benzene/spec, and /benzene/health - it was told to look elsewhere');
  }

  const failing: string[] = [];
  if (health.requirement.verdict !== CloudServiceProbeVerdict.Satisfied) failing.push('R3 (health)');
  if (invoke.requirement.verdict !== CloudServiceProbeVerdict.Satisfied) failing.push('R4 (invoke)');
  if (spec.requirement.verdict !== CloudServiceProbeVerdict.Satisfied) failing.push('R5 (spec)');
  if (mesh.requirement.verdict !== CloudServiceProbeVerdict.Satisfied) failing.push('R6 (mesh)');

  if (failing.length === 0) {
    return new CloudServiceProbeRequirement('R7', description, CloudServiceProbeVerdict.Satisfied,
      'the probe used the spec\'s /benzene/* default paths and R3-R6 all checked out there');
  }
  return new CloudServiceProbeRequirement('R7', description, CloudServiceProbeVerdict.NotSatisfied,
    `the probe used the spec's /benzene/* default paths, but ${failing.join(', ')} did not check out there`);
}

// ---- R8: never observable by a single-service black-box probe; always Inconclusive, with an optional labeled bonus signal. ----
function evaluateR8(options: CloudServiceProbeOptions, invoke: ProbeOutcome, mesh: ProbeOutcome): CloudServiceProbeRequirement {
  const description = 'Trace context join and propagation';
  const baseReason =
    'trace context propagation cannot be verified by a single-service black-box HTTP probe; proving it ' +
    'requires either a second service to observe forwarded traceparent headers, or a mesh collector ' +
    'deriving consumer edges from trace parentage (mesh.md §3-4)';

  if (!options.sendTraceParentProbe) {
    return new CloudServiceProbeRequirement('R8', description, CloudServiceProbeVerdict.Inconclusive, baseReason);
  }

  const nonBreaking =
    invoke.requirement.verdict === CloudServiceProbeVerdict.Satisfied &&
    mesh.requirement.verdict === CloudServiceProbeVerdict.Satisfied;
  const bonus = nonBreaking
    ? ' (weak bonus signal: the service still responded correctly with a synthetic traceparent header attached to the R4/R6 calls - this is non-breakage only, not proof of propagation, and does not upgrade this verdict)'
    : ' (a bonus traceparent header was attached to the R4/R6 calls, but at least one of those calls did not succeed, so even the weak non-breakage signal is absent)';

  return new CloudServiceProbeRequirement('R8', description, CloudServiceProbeVerdict.Inconclusive, baseReason + bonus);
}

function outcome(
  id: string,
  description: string,
  verdict: CloudServiceProbeVerdict,
  reason: string,
  reached: boolean,
): ProbeOutcome {
  return { requirement: new CloudServiceProbeRequirement(id, description, verdict, reason), reached };
}

async function getAsync(
  baseUrl: string,
  path: string,
  fetchFn: ProbeFetch,
  signal: AbortSignal | undefined,
): Promise<HttpResult> {
  try {
    const response = await fetchFn(new URL(path, baseUrl).toString(), { method: 'GET', signal });
    return { reached: true, status: response.status, body: await response.text() };
  } catch (ex) {
    if (signal?.aborted) {
      throw ex; // externally-requested cancellation propagates
    }
    return { reached: false, failureReason: errorMessage(ex) };
  }
}

async function postAsync(
  baseUrl: string,
  path: string,
  jsonContent: string,
  includeTraceParent: boolean,
  fetchFn: ProbeFetch,
  signal: AbortSignal | undefined,
): Promise<HttpResult> {
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (includeTraceParent) {
      headers.traceparent = generateSyntheticTraceParent();
    }
    const response = await fetchFn(new URL(path, baseUrl).toString(), {
      method: 'POST',
      headers,
      body: jsonContent,
      signal,
    });
    return { reached: true, status: response.status, body: await response.text() };
  } catch (ex) {
    if (signal?.aborted) {
      throw ex;
    }
    return { reached: false, failureReason: errorMessage(ex) };
  }
}

/** A syntactically-valid, random W3C traceparent for the R8 bonus probe. */
function generateSyntheticTraceParent(): string {
  const traceId = crypto.getRandomValues(new Uint8Array(16));
  const spanId = crypto.getRandomValues(new Uint8Array(8));
  return `00-${toHex(traceId)}-${toHex(spanId)}-01`;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryGetBoolField(raw: string | undefined, fieldName: string): boolean {
  const node = parseJson(raw);
  return isObject(node) && typeof node[fieldName] === 'boolean';
}

function tryParseNonEmptyObject(raw: string | undefined): boolean {
  const node = parseJson(raw);
  return isObject(node) && Object.keys(node).length > 0;
}

/** Validates the {statusCode, headers, body} response envelope shape and extracts the pre-serialized body string. */
function tryParseEnvelopeResponse(raw: string | undefined):
  | { ok: true; innerBody: string }
  | { ok: false; reason: string } {
  if (raw === undefined || raw.trim() === '') {
    return { ok: false, reason: 'empty response body' };
  }
  const node = parseJson(raw);
  if (node === undefined) {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (!isObject(node)) {
    return { ok: false, reason: 'not a JSON object' };
  }
  if (typeof node.statusCode !== 'string') {
    return { ok: false, reason: "missing a string 'statusCode' field" };
  }
  if (!isObject(node.headers)) {
    return { ok: false, reason: "missing an object 'headers' field" };
  }
  if (typeof node.body !== 'string') {
    return { ok: false, reason: "missing a string 'body' field" };
  }
  return { ok: true, innerBody: node.body };
}

/** Parses an envelope's inner body as a descriptor (mesh.md §2) and requires a non-empty "service" field. */
function tryParseDescriptor(innerBody: string | undefined):
  | { ok: true; descriptor: Record<string, unknown> }
  | { ok: false; reason: string } {
  if (innerBody === undefined || innerBody.trim() === '') {
    return { ok: false, reason: 'empty envelope body' };
  }
  const node = parseJson(innerBody);
  if (node === undefined) {
    return { ok: false, reason: 'envelope body is not valid JSON' };
  }
  if (!isObject(node)) {
    return { ok: false, reason: 'envelope body is not a JSON object' };
  }
  if (typeof node.service !== 'string' || node.service === '') {
    return { ok: false, reason: "missing a non-empty string 'service' field" };
  }
  return { ok: true, descriptor: node };
}

function errorMessage(ex: unknown): string {
  return ex instanceof Error ? ex.message : String(ex);
}
