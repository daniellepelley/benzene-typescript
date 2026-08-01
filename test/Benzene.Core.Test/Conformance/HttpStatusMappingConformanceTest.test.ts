/**
 * Runs docs/specification/conformance/http-status-mapping.json against the TypeScript port's HTTP
 * mappers (wire-contracts.md section 4.1). Port of the .NET HttpStatusMappingConformanceTest
 * (Benzene.Conformance.Test/StatusMappingConformanceTest.cs).
 *
 * Forward: the server mapping a Benzene result status to an HTTP response code, via
 * `DefaultHttpStatusCodeMapper`. Reverse: a client mapping an HTTP response code back to a result
 * status, via `convertHttpStatusCode` (the port of C# `HttpStatusCode.Convert()`), which is the exact
 * mapper the .NET reverse test exercises.
 */
import { describe, expect, it } from 'vitest';
import { convertHttpStatusCode } from '@benzene/results';
import { DefaultHttpStatusCodeMapper } from '@benzene/http';
import { load } from './ConformanceFixtures';

interface MappingRow {
  from: string;
  to: string;
}

interface MappingFixture {
  forward: MappingRow[];
  reverse: MappingRow[];
}

const fixture = load<MappingFixture>('http-status-mapping.json');

describe('HttpStatusMappingConformanceTest', () => {
  describe('forward: Benzene status -> HTTP status code', () => {
    const mapper = new DefaultHttpStatusCodeMapper();
    for (const row of fixture.forward) {
      it(`${row.from} -> ${row.to}`, () => {
        const input = row.from === '<unknown>' ? 'SomeUnknownStatus' : row.from;
        expect(mapper.map(input)).toBe(row.to);
      });
    }
  });

  describe('reverse: HTTP status code -> Benzene status', () => {
    for (const row of fixture.reverse) {
      it(`${row.from} -> ${row.to}`, () => {
        expect(convertHttpStatusCode(Number.parseInt(row.from, 10)).status).toBe(row.to);
      });
    }
  });
});
