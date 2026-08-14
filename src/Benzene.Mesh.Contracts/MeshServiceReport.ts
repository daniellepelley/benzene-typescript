/** Port of Benzene.Mesh.Contracts.MeshServiceReport. */
import { HealthCheckResponse } from '@benzenejs/health-checks-core';

/**
 * A service's self-reported spec/health, pushed rather than pulled - for services with no synchronous
 * entry point to poll. Narrower than `MeshServiceSnapshot`: whatever receives this (an
 * `IMeshReportPublisher`) computes hashes/drift, so pushed and pulled paths compute drift identically.
 */
export class MeshServiceReport {
  constructor(
    readonly name: string,
    readonly reportedAtUtc: number,
    readonly specJson: string | undefined,
    readonly health: HealthCheckResponse | undefined,
    readonly error: string | undefined,
  ) {}
}
