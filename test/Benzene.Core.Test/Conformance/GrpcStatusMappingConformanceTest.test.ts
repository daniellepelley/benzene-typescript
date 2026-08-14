/**
 * Runs docs/specification/conformance/grpc-status-mapping.json against the TypeScript port's gRPC
 * mappers (wire-contracts.md section 4.2). Port of the .NET GrpcStatusMappingConformanceTest
 * (Benzene.Conformance.Test/StatusMappingConformanceTest.cs).
 *
 * Forward: the server mapping a Benzene result status to a gRPC StatusCode, via
 * `DefaultGrpcStatusCodeMapper`. Reverse: a client mapping a gRPC StatusCode back to a result status
 * when no `benzene-status` trailer is present, via `DefaultGrpcStatusReverseMapper`. grpc-js's
 * `status` enum matches `Grpc.Core.StatusCode` name-for-name, so the fixture's gRPC code names index
 * straight into it.
 */
import { describe, expect, it } from 'vitest';
import { status } from '@grpc/grpc-js';
import { DefaultGrpcStatusCodeMapper } from '@benzenejs/grpc';
import { DefaultGrpcStatusReverseMapper } from '@benzenejs/grpc-client';
import { load } from './ConformanceFixtures';

interface MappingRow {
  from: string;
  to: string;
}

interface MappingFixture {
  forward: MappingRow[];
  reverse: MappingRow[];
}

const fixture = load<MappingFixture>('grpc-status-mapping.json');

/**
 * Resolve a gRPC status-code name to the grpc-js `status` enum member. The fixture names are
 * PascalCase (mirroring .NET's `Grpc.Core.StatusCode`, e.g. "InvalidArgument"); grpc-js's `status`
 * enum keys are SCREAMING_SNAKE_CASE ("INVALID_ARGUMENT"), so convert before indexing. grpc-js and
 * Grpc.Core share the same numeric values, so this only bridges the naming convention.
 */
function statusCode(name: string): status {
  const key = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  const value = (status as unknown as Record<string, number>)[key];
  if (value === undefined) {
    throw new Error(`Unknown gRPC status code name in fixture: ${name} (as ${key})`);
  }
  return value as status;
}

describe('GrpcStatusMappingConformanceTest', () => {
  describe('forward: Benzene status -> gRPC status code', () => {
    const mapper = new DefaultGrpcStatusCodeMapper();
    for (const row of fixture.forward) {
      it(`${row.from} -> ${row.to}`, () => {
        const input = row.from === '<unknown>' ? 'SomeUnknownStatus' : row.from;
        expect(mapper.map(input)).toBe(statusCode(row.to));
      });
    }
  });

  describe('reverse: gRPC status code -> Benzene status', () => {
    const mapper = new DefaultGrpcStatusReverseMapper();
    for (const row of fixture.reverse) {
      it(`${row.from} -> ${row.to}`, () => {
        expect(mapper.map(statusCode(row.from), undefined)).toBe(row.to);
      });
    }
  });
});
