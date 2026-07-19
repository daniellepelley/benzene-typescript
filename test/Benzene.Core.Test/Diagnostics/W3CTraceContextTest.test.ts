import { describe, expect, it } from 'vitest';
import { CorrelationExtensions } from '@benzene/diagnostics';

/**
 * Port of Benzene.Test.Diagnostics.W3CTraceContextTest.
 *
 * The C# test drives the full `UseW3CTraceContext` middleware and asserts against a
 * `System.Diagnostics.Activity` built from the parsed context (via an `ActivityListener`). That
 * Activity distributed-tracing surface is deferred in this port (it needs a Node tracing
 * abstraction), so these tests exercise the portable, load-bearing slice — the `traceparent`
 * parsing/validation itself — asserting the same three behaviors: a valid header yields the
 * remote trace-id/parent-span-id, and a missing or invalid header falls back without throwing.
 */
describe('W3CTraceContextTest', () => {
  it('ValidTraceparent_BecomesTheActivitysParent', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const parentSpanId = '00f067aa0ba902b7';

    const parsed = CorrelationExtensions.parseTraceparent(`00-${traceId}-${parentSpanId}-01`);

    expect(parsed).toBeDefined();
    expect(parsed?.traceId).toBe(traceId);
    expect(parsed?.parentSpanId).toBe(parentSpanId);
  });

  it('MissingTraceparent_StartsANewTrace_WithoutThrowing', () => {
    expect(() => CorrelationExtensions.parseTraceparent(undefined)).not.toThrow();
    expect(CorrelationExtensions.parseTraceparent(undefined)).toBeUndefined();
    expect(CorrelationExtensions.parseTraceparent('')).toBeUndefined();
  });

  it('InvalidTraceparent_StartsANewTrace_WithoutThrowing', () => {
    expect(() => CorrelationExtensions.parseTraceparent('not-a-valid-traceparent')).not.toThrow();
    expect(CorrelationExtensions.parseTraceparent('not-a-valid-traceparent')).toBeUndefined();
  });

  it('AllZeroTraceId_IsRejected', () => {
    // Matches System.Diagnostics.ActivityContext.TryParse rejecting an all-zero trace-id/parent-id.
    expect(
      CorrelationExtensions.parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01'),
    ).toBeUndefined();
    expect(
      CorrelationExtensions.parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'),
    ).toBeUndefined();
  });
});
