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
 * implementation (ingest, declared graph, heartbeat health, issues feed, five `mesh:query:*` read
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

// Each entry names a fixture that speaks the collector step model; both are vendored, and both run.
const fixtures: ReadonlyArray<[string, CollectorFixture]> = [
  ['mesh-collector-cases.json', load<CollectorFixture>('mesh-collector-cases.json')],
  ['mesh-issue-cases.json', load<CollectorFixture>('mesh-issue-cases.json')],
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
 * The canonical fixture's reserved topic ids carry the spec's `benzene:` namespace prefix
 * (`benzene:mesh:register`, `benzene:mesh:query:fleet`, ..., mesh.md §§1/4). This port's own reserved
 * topic constants (`@benzenejs/mesh-wire`'s `MeshTopics`, `@benzenejs/mesh-collector`'s
 * `MeshCollectorTopics`) - and every existing test/example that addresses them - use the same ids
 * WITHOUT that prefix (`mesh:register`, `mesh:query:fleet`, ...; see e.g. `MeshWireExtensionsTest`'s
 * use of `MeshTopics.descriptor` for the bare `mesh` topic). That is a pre-existing, whole-port naming
 * divergence predating this fixture - out of scope for this collector-conformance addition to fix - so
 * this strips the prefix before dispatch, exactly the adaptation this port's transport bindings would
 * need to make for real cross-language interop.
 */
function toRequest(step: CollectorStep): BenzeneMessageRequest {
  const request = new BenzeneMessageRequest();
  request.topic = step.request.topic.startsWith('benzene:') ? step.request.topic.slice('benzene:'.length) : step.request.topic;
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
