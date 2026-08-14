/**
 * Port of the wire-facing half of Benzene.Test.Mesh.Wire.MeshIssuesTest (spec §4.1): the classification
 * precedence table and the normative fingerprint recipe. The C# suite's emitter-middleware cases
 * (`UseMeshIssues`/`IMeshIssueExporter`/`MeshIssueOccurrence`) are the mesh service-side emitter, not part of
 * `@benzenejs/mesh-wire`'s ported surface, so they are out of scope here.
 */
import { describe, expect, it } from 'vitest';
import { MeshIssueClassification, MeshIssueFingerprint } from '@benzenejs/mesh-wire';

describe('MeshIssueClassification', () => {
  it('Classification_FollowsThePrecedenceTable', () => {
    // 1. Validation statuses win even when an exception was thrown.
    expect(MeshIssueClassification.classify('bad-request', 'SyntaxError')).toBe(MeshIssueClassification.validation);
    expect(MeshIssueClassification.classify('validation-error', undefined)).toBe(MeshIssueClassification.validation);
    // 2. A thrown-and-converted failure classifies by its throw, not its mapped status.
    expect(MeshIssueClassification.classify('service-unavailable', 'TypeError')).toBe(MeshIssueClassification.exception);
    // 3. Wiring/config drift, including the empty-status wiring gap; unauthorized is config, not dependency.
    expect(MeshIssueClassification.classify('not-found', undefined)).toBe(MeshIssueClassification.configWiring);
    expect(MeshIssueClassification.classify('unauthorized', undefined)).toBe(MeshIssueClassification.configWiring);
    expect(MeshIssueClassification.classify('', undefined)).toBe(MeshIssueClassification.configWiring);
    // 4. Dependency only when nothing was thrown.
    expect(MeshIssueClassification.classify('service-unavailable', undefined)).toBe(MeshIssueClassification.dependency);
    expect(MeshIssueClassification.classify('timeout', undefined)).toBe(MeshIssueClassification.dependency);
    // 5-6. The wire's unclassified-failure status is exception-shaped; anything else is honest.
    expect(MeshIssueClassification.classify('unexpected-error', undefined)).toBe(MeshIssueClassification.exception);
    expect(MeshIssueClassification.classify('conflict', undefined)).toBe(MeshIssueClassification.unclassified);
  });
});

describe('MeshIssueFingerprint', () => {
  it('Fingerprint_FollowsTheNormativeRecipe', () => {
    // Deterministic, 32 lowercase hex chars, exceptionType preferred as the discriminator, transport never
    // part of the identity.
    const a = MeshIssueFingerprint.compute('orders', 'order:create', 'v2', 'exception', 'System.TimeoutException', 'service-unavailable');
    const b = MeshIssueFingerprint.compute('orders', 'order:create', 'v2', 'exception', 'System.TimeoutException', 'timeout');
    const c = MeshIssueFingerprint.compute('orders', 'order:create', 'v2', 'dependency', undefined, 'timeout');

    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toBe(a); // same discriminator (the exception type) -> same identity
    expect(c).not.toBe(a); // different classification/discriminator -> different identity
    // The spec's worked derivation: sha256("orders|order:create|v2|exception|System.TimeoutException")[..16] hex.
    expect(MeshIssueFingerprint.compute('orders', 'order:create', 'v2', 'exception', undefined, 'System.TimeoutException')).toBe(a);
  });
});
