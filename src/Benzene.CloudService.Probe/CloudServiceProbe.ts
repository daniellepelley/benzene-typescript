/** Port of Benzene.CloudService.Probe.CloudServiceProbe. */
import { CloudServiceProbeOptions } from './CloudServiceProbeOptions';
import {
  CloudServiceProbeReport,
  CloudServiceProbeRequirement,
  CloudServiceProbeVerdict,
} from './CloudServiceProbeReport';

/**
 * A `fetch`-like function. Port of the role played by .NET `HttpClient` (HttpClient -> fetch, as in
 * `@benzenejs/health-checks-http`); the C# `HttpClient.BaseAddress` becomes the `baseUrl` argument.
 */
export type ProbeFetch = (url: string, init?: RequestInit) => Promise<Response>;

const HealthDescription = 'Health checks';
const InvokeDescription = 'Wire-envelope invocability';
const SpecDescription = 'Derived spec (HTTP surface + benzene:spec on the envelope)';
const FeedsDescription = 'Mesh service-side feeds (registration, heartbeats, traces)';
const PropagationDescription = 'Trace context join and propagation';

// The reserved topic ids of cloud-service-profile.md R3/R5, spelled out rather than imported: this
// package deliberately has no dependencies (it is a black-box probe, and must be able to probe a
// service built on any Benzene version). `BenzeneTopic` in `@benzenejs/abstractions` is the in-process
// source of truth for the same strings.
const HealthcheckEnvelope = '{"topic":"benzene:healthcheck","headers":{},"body":"{}"}';
// R5's topic half: the contract document on the reserved `benzene:spec` topic, over the envelope.
const SpecEnvelope = '{"topic":"benzene:spec","headers":{},"body":"{}"}';

interface HttpResult {
  reached: boolean;
  status?: number;
  body?: string;
  failureReason?: string;
}

interface ProbeOutcome {
  requirement: CloudServiceProbeRequirement;
  reached: boolean;
}

/** One half of R5: whether it checked out, why, and the contract document's `requests` when it parsed. */
interface SpecHalf {
  ok: boolean;
  reached: boolean;
  reason: string;
  requests?: unknown[];
}

/**
 * Runs an external, black-box conformance probe against a live Benzene Cloud Service, asserting the profile's
 * observable surfaces (R1–R5, R7) from outside - health response shape, envelope round-trip, the spec over HTTP
 * and on the `benzene:spec` topic, default paths - over real HTTP, without relying on anything the service says
 * about itself. The meshed-service claim (mesh.md §7.1, M1 and M2) is reported separately, on the report's
 * `mesh`: neither is observable from outside one service, so both are always `Inconclusive`.
 * Port of Benzene.CloudService.Probe.CloudServiceProbe (a static class -> a const object).
 */
export const CloudServiceProbe = {
  /**
   * Probes the service at `baseUrl` and returns a tri-state assessment of R1–R5 and R7, plus what can be said of
   * M1 and M2. Never throws for an unreachable or non-conformant service - unreachability and shape mismatches
   * are reported as verdicts, not exceptions. (An externally-requested `signal` abort does propagate, matching
   * the C# `ct` behaviour.)
   */
  async runAsync(
    baseUrl: string,
    options: CloudServiceProbeOptions = new CloudServiceProbeOptions(),
    fetchFn: ProbeFetch = fetch,
    signal?: AbortSignal,
  ): Promise<CloudServiceProbeReport> {
    const health = await probeHealthAsync(baseUrl, options, fetchFn, signal);
    const invoke = await probeInvokeAsync(baseUrl, options, fetchFn, signal);
    const specHttp = await probeSpecHttpAsync(baseUrl, options, fetchFn, signal);
    const specTopic = await probeSpecTopicAsync(baseUrl, options, fetchFn, signal);
    const spec = evaluateR5(specHttp, specTopic);

    const requirements: CloudServiceProbeRequirement[] = [
      evaluateR1(health, invoke, spec),
      evaluateR2(specTopic, specHttp),
      health.requirement,
      invoke.requirement,
      spec.requirement,
      evaluateR7(options, health, invoke, spec),
    ];

    return new CloudServiceProbeReport(requirements, [evaluateM1(), evaluateM2(options, invoke, specTopic)]);
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

// ---- R5, HTTP half: GET the spec path; ok iff 200 with a non-empty JSON object. ----
async function probeSpecHttpAsync(
  baseUrl: string,
  options: CloudServiceProbeOptions,
  fetchFn: ProbeFetch,
  signal: AbortSignal | undefined,
): Promise<SpecHalf> {
  const r = await getAsync(baseUrl, options.specPath, fetchFn, signal);
  if (!r.reached) {
    return { ok: false, reached: false, reason: `GET ${options.specPath} did not reach the service: ${r.failureReason}` };
  }
  if (r.status !== 200) {
    return { ok: false, reached: true, reason: `GET ${options.specPath} returned ${r.status}, expected 200` };
  }
  if (!tryParseNonEmptyObject(r.body)) {
    return { ok: false, reached: true,
      reason: `200 response at ${options.specPath} did not parse as a non-empty JSON object - a real derived document is expected there` };
  }
  const document = tryParseContractDocument(r.body);
  return {
    ok: true,
    reached: true,
    reason: `GET ${options.specPath} returned 200 with a non-empty JSON object body`,
    requests: document.ok ? requestsOf(document.document) : undefined,
  };
}

// ---- R5, topic half: POST topic "benzene:spec" over the envelope; ok iff the 200 envelope wraps the contract
// document (a non-empty "service"). R5 requires the reserved topic answered wherever the transport carries a
// reply; the HTTP envelope does, and is the one a probe can reach. ----
async function probeSpecTopicAsync(
  baseUrl: string,
  options: CloudServiceProbeOptions,
  fetchFn: ProbeFetch,
  signal: AbortSignal | undefined,
): Promise<SpecHalf> {
  const r = await postAsync(baseUrl, options.invokePath, SpecEnvelope, options.sendTraceParentProbe, fetchFn, signal);
  if (!r.reached) {
    return { ok: false, reached: false,
      reason: `POST ${options.invokePath} with topic 'benzene:spec' did not reach the service: ${r.failureReason}` };
  }
  if (r.status !== 200) {
    return { ok: false, reached: true,
      reason: `POST ${options.invokePath} with topic 'benzene:spec' returned ${r.status}, expected 200 (the reserved spec topic does not appear to be served over the envelope)` };
  }
  const envelope = tryParseEnvelopeResponse(r.body);
  if (!envelope.ok) {
    return { ok: false, reached: true,
      reason: `200 response to the 'benzene:spec' topic did not have the {statusCode, headers, body} envelope shape (wire-contracts.md §1.2): ${envelope.reason}` };
  }
  const document = tryParseContractDocument(envelope.innerBody);
  if (!document.ok) {
    return { ok: false, reached: true,
      reason: `200 response to the 'benzene:spec' topic did not parse as a contract document with a non-empty 'service' field (contract-document.md §1): ${document.reason}` };
  }
  return {
    ok: true,
    reached: true,
    reason: `the reserved 'benzene:spec' topic served the contract document for service '${String(document.document.service)}' over the envelope`,
    requests: requestsOf(document.document),
  };
}

// ---- R5: both halves must check out - the HTTP surface and the reserved topic over the envelope. ----
function evaluateR5(http: SpecHalf, topic: SpecHalf): ProbeOutcome {
  const reason = `${http.reason}; ${topic.reason}`;
  const verdict = http.ok && topic.ok ? CloudServiceProbeVerdict.Satisfied : CloudServiceProbeVerdict.NotSatisfied;
  return outcome('R5', SpecDescription, verdict, reason, http.reached || topic.reached);
}

// ---- R1: inferential - satisfied iff anything responded at all. ----
function evaluateR1(health: ProbeOutcome, invoke: ProbeOutcome, spec: ProbeOutcome): CloudServiceProbeRequirement {
  const description = 'Hosted middleware pipeline';
  const anyReached = health.reached || invoke.reached || spec.reached;
  return anyReached
    ? new CloudServiceProbeRequirement('R1', description, CloudServiceProbeVerdict.Satisfied,
        'at least one probed surface responded over HTTP, which proves a hosted pipeline exists behind a transport binding - an in-process-only pipeline would have nothing for this probe to reach')
    : new CloudServiceProbeRequirement('R1', description, CloudServiceProbeVerdict.NotSatisfied,
        'none of the health, invoke, spec, or benzene:spec surfaces responded at all; no hosted pipeline was reachable at the configured base address');
}

// ---- R2: inferential from the contract document's requests (the benzene:spec topic's, else the HTTP surface's). ----
function evaluateR2(topic: SpecHalf, http: SpecHalf): CloudServiceProbeRequirement {
  const description = 'Message handlers via the registry';
  const requests = topic.requests ?? http.requests;
  if (requests === undefined) {
    return new CloudServiceProbeRequirement('R2', description, CloudServiceProbeVerdict.Inconclusive,
      'no contract document reachable (on the benzene:spec topic or the spec path) to read registered requests from - absence of evidence isn\'t evidence of absence');
  }
  if (requests.length > 0) {
    return new CloudServiceProbeRequirement('R2', description, CloudServiceProbeVerdict.Satisfied,
      `the contract document lists ${requests.length} request(s) (contract-document.md §2), which can only be populated from the handler registry`);
  }
  return new CloudServiceProbeRequirement('R2', description, CloudServiceProbeVerdict.Inconclusive,
    'the contract document is reachable but lists no requests; a service can legitimately have zero handlers registered so far - absence of evidence isn\'t evidence of absence');
}

// ---- R7: only assessable when the probe itself used the defaults. ----
function evaluateR7(
  options: CloudServiceProbeOptions,
  health: ProbeOutcome,
  invoke: ProbeOutcome,
  spec: ProbeOutcome,
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

  if (failing.length === 0) {
    return new CloudServiceProbeRequirement('R7', description, CloudServiceProbeVerdict.Satisfied,
      'the probe used the spec\'s /benzene/* default paths and R3-R5 all checked out there');
  }
  return new CloudServiceProbeRequirement('R7', description, CloudServiceProbeVerdict.NotSatisfied,
    `the probe used the spec's /benzene/* default paths, but ${failing.join(', ')} did not check out there`);
}

// ---- M1 (mesh.md §7.1, formerly R6): the feeds go to a collector, never to the prober - always Inconclusive. ----
function evaluateM1(): CloudServiceProbeRequirement {
  return new CloudServiceProbeRequirement('M1', FeedsDescription, CloudServiceProbeVerdict.Inconclusive,
    'not observable from outside: registration (benzene:mesh:register), heartbeat (benzene:mesh:heartbeat) and trace ' +
    '(benzene:mesh:traces) delivery go to a collector, not to the caller, so probing the service alone cannot see them - ' +
    'ask the collector whether the service registered');
}

// ---- M2 (mesh.md §7.1, formerly R8): never observable by a single-service black-box probe; always Inconclusive,
// with an optional labeled bonus signal. ----
function evaluateM2(options: CloudServiceProbeOptions, invoke: ProbeOutcome, specTopic: SpecHalf): CloudServiceProbeRequirement {
  const baseReason =
    'not observable from outside: trace context propagation cannot be verified by a single-service black-box HTTP ' +
    'probe; proving it requires either a second service to observe forwarded traceparent headers, or a mesh ' +
    'collector observing trace parentage as the additive, observed-only liveness/drift signal it feeds (never the ' +
    'producer/consumer graph itself, which is declared from the registered contract document alone - mesh.md §3-4, §4.2)';

  if (!options.sendTraceParentProbe) {
    return new CloudServiceProbeRequirement('M2', PropagationDescription, CloudServiceProbeVerdict.Inconclusive, baseReason);
  }

  const nonBreaking = invoke.requirement.verdict === CloudServiceProbeVerdict.Satisfied && specTopic.ok;
  const bonus = nonBreaking
    ? ' (weak bonus signal: the service still responded correctly with a synthetic traceparent header attached to the envelope calls - this is non-breakage only, not proof of propagation, and does not upgrade this verdict)'
    : ' (a bonus traceparent header was attached to the envelope calls, but at least one of those calls did not succeed, so even the weak non-breakage signal is absent)';

  return new CloudServiceProbeRequirement('M2', PropagationDescription, CloudServiceProbeVerdict.Inconclusive, baseReason + bonus);
}

function requestsOf(document: Record<string, unknown>): unknown[] | undefined {
  return Array.isArray(document.requests) ? (document.requests as unknown[]) : undefined;
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

/** A syntactically-valid, random W3C traceparent for the M2 bonus probe. */
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

/** Parses an envelope's inner body as a contract document (contract-document.md §1) and requires a non-empty "service" field. */
function tryParseContractDocument(innerBody: string | undefined):
  | { ok: true; document: Record<string, unknown> }
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
  return { ok: true, document: node };
}

function errorMessage(ex: unknown): string {
  return ex instanceof Error ? ex.message : String(ex);
}
