/**
 * Runs docs/specification/conformance/mesh-collector-cases.json AND mesh-issue-cases.json against
 * the TypeScript port's spec collector (`@benzenejs/mesh-collector`) - ingest/validation, the declared producer/consumer graph
 * (mesh.md §4, the 2026-08 revision: "the graph MUST be built from the latest registered
 * ServiceDescriptor alone"), heartbeat-driven health/hash-mismatch, and re-registration replacing both
 * provider and consumer edges wholesale.
 *
 * Each case's `steps` run in order against ONE fresh collector (a real `BenzeneMessageApplication`
 * with the collector's nine handlers wired on their reserved topics, mirroring
 * `examples/k8s-mesh`'s `addMeshCollector` - reused here rather than re-implemented, since it is
 * already the proven "bind `MeshCollectorHandlers` with no `@message` decorators" wiring), asserted
 * like an envelope case (statusCode exact, body parsed-JSON subset). This is this port's collector
 * conformance runner - `Benzene.Mesh.Collector` was investigated and found to be a full collector
 * implementation (ingest, declared graph, heartbeat health, issues feed, five `benzene:mesh:query:*` read
 * models) with no existing conformance runner, so this vendors the fixture and adds one.
 *
 * Both fixtures share one step/assertion model, so both run through the same driver here - the same
 * pairing the Python port makes (`run_mesh_collector` runs `mesh-collector-cases.json` +
 * `mesh-issue-cases.json` through one `run_collector_fixture`). The issue feed this port claims is
 * real: `MeshCollectorHandlers.issues` (`src/Benzene.Mesh.Collector/Handlers.ts`) ingests the batch
 * and `MeshCollectorStore.recordIssues` does the fingerprint delta-merge the fixture asserts.
 */
import { describe, expect, it } from 'vitest';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { addMeshCollector } from '../../../examples/k8s-mesh/src/meshCollector';
import { findSubsetMismatch, load } from './ConformanceFixtures';

interface CollectorStep {
  request: { topic: string; headers: Record<string, string>; body: string };
  expected: { statusCode: string; body?: unknown };
}

interface CollectorCase {
  name: string;
  steps: CollectorStep[];
}

interface CollectorFixture {
  cases: CollectorCase[];
}

// Each entry names a fixture that speaks the collector step model; all three are vendored, and all
// three run. `mesh-service-version-cases.json` (mesh.md §2.4) pins the versioned catalog this port
// claims: the catalog keyed by (service, serviceVersion), so side-by-side releases are two entries,
// re-registering one version never disturbs another, and an omitted serviceVersion keys exactly as
// it always did.
const fixtures: ReadonlyArray<[string, CollectorFixture]> = [
  ['mesh-collector-cases.json', load<CollectorFixture>('mesh-collector-cases.json')],
  ['mesh-issue-cases.json', load<CollectorFixture>('mesh-issue-cases.json')],
  ['mesh-service-version-cases.json', load<CollectorFixture>('mesh-service-version-cases.json')],
];

/** One fresh collector - a real pipeline wired exactly as `examples/k8s-mesh` wires its live collector. */
function newCollector() {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);
  addMeshCollector(container);

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlers(builder);

  const application = new BenzeneMessageApplication(builder.build());
  const resolverFactory = container.createServiceResolverFactory();
  return { application, resolverFactory };
}

/**
 * The fixture's reserved topic ids are dispatched verbatim - this port binds the same `benzene:`-prefixed
 * ids the spec declares (mesh.md §§1/4, `BenzeneTopic`/`MeshTopics`/`MeshCollectorTopics`), so no
 * adaptation is needed or wanted here. An earlier revision of this test stripped the prefix before
 * dispatch, which kept the suite green while the port was in fact unreachable from any other language's
 * mesh participant; the strip is gone and the port carries the prefix instead.
 */
function toRequest(step: CollectorStep): BenzeneMessageRequest {
  const request = new BenzeneMessageRequest();
  request.topic = step.request.topic;
  request.headers = step.request.headers;
  request.body = step.request.body;
  return request;
}

describe('MeshCollectorConformanceTest', () => {
  for (const [fixtureName, fixture] of fixtures) {
    describe(fixtureName, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, async () => {
          const { application, resolverFactory } = newCollector();

          for (const [index, step] of testCase.steps.entries()) {
            const response = await application.handleAsync(toRequest(step), resolverFactory);
            const stepLabel = `${fixtureName}/${testCase.name}[${index}] ${step.request.topic}`;

            expect(response.statusCode, stepLabel).toBe(step.expected.statusCode);

            if (step.expected.body !== undefined) {
              expect(response.body, `${stepLabel}: expected a response body but none was written`).toBeTruthy();
              const actualBody = JSON.parse(response.body) as unknown;
              const mismatch = findSubsetMismatch(step.expected.body, actualBody);
              expect(mismatch, mismatch ? `${stepLabel}: ${mismatch}` : undefined).toBeNull();
            }
          }
        });
      }
    });
  }
});
