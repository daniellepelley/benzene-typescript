/**
 * The reserved-topic namespace: `BenzeneTopic` is this port's single source of truth for the
 * framework-owned topic ids, and every reserved id the port binds MUST carry its `benzene:` marker.
 *
 * This is an interop test, not a style test. `docs/specification/cloud-service-profile.md` R3 requires
 * `benzene:healthcheck` and R5 `benzene:spec`, and the meshed-service claim's M1 (`mesh.md` §7.1) requires
 * `benzene:mesh:register` / `benzene:mesh:heartbeat` / `benzene:mesh:traces` **by id**; `mesh.md` §§1/4 pins
 * the same ids on the wire. A port that binds the bare forms cannot register with, heartbeat to, or be health-probed by a
 * collector written in any other language, which is exactly the state this port was in until the ids
 * were prefixed. The literals below are therefore spelled out rather than derived from the constants:
 * the point is to fail loudly if a constant's VALUE ever drifts.
 */
import { describe, expect, it } from 'vitest';
import { BenzeneTopic } from '@benzenejs/abstractions';
import { Constants as HealthCheckConstants } from '@benzenejs/health-checks';
import { Constants as SchemaConstants } from '@benzenejs/schema-openapi';
import { MeshTopics } from '@benzenejs/mesh-wire';
import { MeshCollectorTopics } from '@benzenejs/mesh-collector';
import { DispatchTopic } from '@benzenejs/mesh-dispatch';

describe('BenzeneTopic', () => {
  it('pins every framework-owned id to its wire value', () => {
    expect(BenzeneTopic.prefix).toBe('benzene:');
    expect(BenzeneTopic.spec).toBe('benzene:spec');
    expect(BenzeneTopic.testPayloads).toBe('benzene:test-payloads');
    expect(BenzeneTopic.healthCheck).toBe('benzene:healthcheck');
    expect(BenzeneTopic.liveness).toBe('benzene:liveness');
    expect(BenzeneTopic.readiness).toBe('benzene:readiness');
    expect(BenzeneTopic.ping).toBe('benzene:ping');
  });

  it('isReserved tests the prefix, so it recognises mesh and future framework topics too', () => {
    expect(BenzeneTopic.isReserved('benzene:healthcheck')).toBe(true);
    expect(BenzeneTopic.isReserved('benzene:mesh:query:fleet')).toBe(true);
    expect(BenzeneTopic.isReserved('BENZENE:MESH')).toBe(true);
    expect(BenzeneTopic.isReserved('order:create')).toBe(false);
    // The bare pre-prefix ids are ordinary application topics now - nothing special about them.
    expect(BenzeneTopic.isReserved('healthcheck')).toBe(false);
    expect(BenzeneTopic.isReserved('mesh')).toBe(false);
    expect(BenzeneTopic.isReserved(undefined)).toBe(false);
    expect(BenzeneTopic.isReserved('')).toBe(false);
  });

  it('isKnown is the narrower list test', () => {
    expect(BenzeneTopic.isKnown('benzene:spec')).toBe(true);
    expect(BenzeneTopic.isKnown('BENZENE:SPEC')).toBe(true);
    // Spec 3b removed the mesh self-description topic: the self-description is benzene:spec.
    expect(BenzeneTopic.isKnown('benzene:mesh')).toBe(false);
    expect(BenzeneTopic.isReserved('benzene:mesh')).toBe(true);
    // Prefixed, so reserved - but not one of the ids this module declares.
    expect(BenzeneTopic.isKnown('benzene:mesh:register')).toBe(false);
    expect(BenzeneTopic.isReserved('benzene:mesh:register')).toBe(true);
    expect(BenzeneTopic.isKnown('order:create')).toBe(false);
    expect(BenzeneTopic.isKnown(undefined)).toBe(false);
  });

  it('enumerates its ids, all of them prefixed', () => {
    expect(BenzeneTopic.all).toContain('benzene:healthcheck');
    expect(BenzeneTopic.all.every((id) => BenzeneTopic.isReserved(id))).toBe(true);
  });
});

describe('reserved topic ids across the port', () => {
  it('binds the profile R3 health-check id and its liveness/readiness siblings', () => {
    expect(HealthCheckConstants.defaultHealthCheckTopic).toBe('benzene:healthcheck');
    expect(HealthCheckConstants.defaultLivenessTopic).toBe('benzene:liveness');
    expect(HealthCheckConstants.defaultReadinessTopic).toBe('benzene:readiness');
  });

  it('binds the profile R5 spec id', () => {
    expect(SchemaConstants.DefaultSpecTopic).toBe('benzene:spec');
  });

  it('binds the M1 mesh feed ids (mesh.md §4, §7.1)', () => {
    expect(Object.values(MeshTopics)).not.toContain('benzene:mesh');
    expect(MeshTopics.register).toBe('benzene:mesh:register');
    expect(MeshTopics.heartbeat).toBe('benzene:mesh:heartbeat');
    expect(MeshTopics.traces).toBe('benzene:mesh:traces');
    expect(MeshTopics.issues).toBe('benzene:mesh:issues');
  });

  it('binds the collector read-model and dispatch ids', () => {
    expect(MeshCollectorTopics.queryFleet).toBe('benzene:mesh:query:fleet');
    expect(MeshCollectorTopics.queryService).toBe('benzene:mesh:query:service');
    expect(MeshCollectorTopics.queryTopic).toBe('benzene:mesh:query:topic');
    expect(MeshCollectorTopics.queryTrace).toBe('benzene:mesh:query:trace');
    expect(MeshCollectorTopics.queryCorrelation).toBe('benzene:mesh:query:correlation');
    expect(DispatchTopic).toBe('benzene:mesh:dispatch');
  });

  it('leaves no reserved constant unmarked', () => {
    const everyReservedId = [
      ...BenzeneTopic.all,
      ...Object.values(HealthCheckConstants).filter((v) => v !== HealthCheckConstants.healthCheckMiddlewareName),
      ...Object.values(SchemaConstants),
      ...Object.values(MeshTopics),
      ...Object.values(MeshCollectorTopics),
      DispatchTopic,
    ];

    expect(everyReservedId.filter((id) => !BenzeneTopic.isReserved(id))).toEqual([]);
  });
});
