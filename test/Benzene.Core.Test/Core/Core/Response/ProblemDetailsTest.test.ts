/**
 * The RFC 9457 problem-document half of wire-contracts.md §1.3, and the `isSuccessful`-aware status
 * mapping of §1.2/§4.1/§4.2, in the cases the language-neutral conformance fixtures can't reach: the
 * `ProblemTypes` registry itself, an application-defined status (which by definition has no fixture
 * row), and the client-side preference for the envelope's `isSuccessful` over status-derived
 * classification.
 */
import { describe, expect, it } from 'vitest';
import { status } from '@grpc/grpc-js';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { BenzeneResult, BenzeneResultStatus, ProblemTypes } from '@benzenejs/results';
import { asBenzeneResult, BenzeneMessageClientResponse } from '@benzenejs/clients';
import { DefaultHttpStatusCodeMapper } from '@benzenejs/http';
import { DefaultGrpcStatusCodeMapper } from '@benzenejs/grpc';

describe('ProblemTypes', () => {
  it('maps every known failure status to its registry row', () => {
    expect(ProblemTypes.typeFor(BenzeneResultStatus.notFound)).toBe(
      'https://benzene.app/problems/not-found',
    );
    expect(ProblemTypes.titleFor(BenzeneResultStatus.notFound)).toBe('Not found');
    expect(ProblemTypes.httpStatusFor(BenzeneResultStatus.notFound)).toBe(404);
    expect(ProblemTypes.httpStatusFor(BenzeneResultStatus.timeout)).toBe(504);
  });

  it('has no row for a success status — problems exist only on failure', () => {
    expect(ProblemTypes.typeFor(BenzeneResultStatus.ok)).toBeUndefined();
    expect(ProblemTypes.titleFor(BenzeneResultStatus.created)).toBeUndefined();
  });

  it('leaves type/title unset for an application-defined status, and falls to 500 for its HTTP code', () => {
    expect(ProblemTypes.typeFor('order-already-shipped')).toBeUndefined();
    expect(ProblemTypes.titleFor('order-already-shipped')).toBeUndefined();
    expect(ProblemTypes.httpStatusFor('order-already-shipped')).toBe(500);
    expect(ProblemTypes.typeFor(undefined)).toBeUndefined();
  });

  it('builds a document carrying benzeneStatus and the ordered errors, and never the HTTP status', () => {
    const problem = ProblemTypes.from(
      BenzeneResult.setErrors(BenzeneResultStatus.badRequest, 'first error', 'second error'),
    );

    expect(problem.type).toBe(ProblemTypes.badRequest);
    expect(problem.title).toBe('Bad request');
    expect(problem.benzeneStatus).toBe(BenzeneResultStatus.badRequest);
    // The compatibility member: the same joined string the pre-RFC-9457 `ErrorPayload` carried.
    expect(problem.detail).toBe('first error, second error');
    expect(problem.errors).toEqual([{ message: 'first error' }, { message: 'second error' }]);
    // Transport-neutral: `status` is the integer HTTP code, and only the HTTP-aware mapper fills it in.
    expect(problem.status).toBeUndefined();
    expect('status' in JSON.parse(new JsonSerializer().serialize(problem))).toBe(false);
  });

  it('omits detail and errors entirely when the result carries no error messages', () => {
    const problem = ProblemTypes.from(BenzeneResult.notFound());

    expect(problem.detail).toBeUndefined();
    expect(problem.errors).toBeUndefined();
    expect(problem.benzeneStatus).toBe(BenzeneResultStatus.notFound);
  });
});

describe('isSuccessful-aware status mapping', () => {
  it('maps a known status by its own row whatever isSuccessful says', () => {
    expect(new DefaultHttpStatusCodeMapper().map(BenzeneResultStatus.notFound, true)).toBe('404');
    expect(new DefaultGrpcStatusCodeMapper().map(BenzeneResultStatus.notFound, true)).toBe(
      status.NOT_FOUND,
    );
  });

  it('honors isSuccessful for an application-defined status outside the vocabulary', () => {
    const http = new DefaultHttpStatusCodeMapper();
    expect(http.map('order-already-shipped', true)).toBe('200');
    expect(http.map('order-already-shipped', false)).toBe('500');
    // Omitting the flag is C#'s status-only overload: unknown falls to the generic-error row.
    expect(http.map('order-already-shipped')).toBe('500');

    const grpc = new DefaultGrpcStatusCodeMapper();
    expect(grpc.map('order-already-shipped', true)).toBe(status.OK);
    expect(grpc.map('order-already-shipped', false)).toBe(status.INTERNAL);
    expect(grpc.map('order-already-shipped')).toBe(status.INTERNAL);
  });
});

describe('asBenzeneResult classification', () => {
  const serializer = new JsonSerializer();

  it("prefers the envelope's isSuccessful over the status vocabulary", () => {
    // `ignored` is a success status, but this sender says otherwise - the wire wins (§1.2).
    const response = new BenzeneMessageClientResponse(BenzeneResultStatus.ignored, '', {}, false);

    expect(asBenzeneResult(response, serializer).isSuccessful).toBe(false);
  });

  it('falls back to the status vocabulary when the sender did not write isSuccessful', () => {
    expect(
      asBenzeneResult(new BenzeneMessageClientResponse(BenzeneResultStatus.ok, ''), serializer)
        .isSuccessful,
    ).toBe(true);
    expect(
      asBenzeneResult(new BenzeneMessageClientResponse(BenzeneResultStatus.notFound, ''), serializer)
        .isSuccessful,
    ).toBe(false);
  });
});
