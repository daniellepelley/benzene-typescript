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

describe('asBenzeneResult failure bodies (RFC 9457 problem documents)', () => {
  // The client-side half of .NET's AsBenzeneResult: a failure body is read as a problem document and
  // its information surfaced on the result (the W3.12 error-payload remainder — no longer payload-less).
  const serializer = new JsonSerializer();

  it("populates the result's structured errors from the document's errors member — field, code and order intact", () => {
    // Phase 5 of the .NET problem-details plan: a multi-error problem body's `errors` member is
    // authoritative and round-trips as structured BenzeneErrors rather than one joined detail string.
    const body = serializer.serialize({
      benzeneStatus: BenzeneResultStatus.validationError,
      detail: 'Name must not be empty, Age must be positive',
      errors: [
        { message: 'Name must not be empty', field: '/name', code: 'NotEmpty' },
        { message: 'Age must be positive', field: '/age', code: 'Positive' },
      ],
    });
    const response = new BenzeneMessageClientResponse(BenzeneResultStatus.validationError, body, {}, false);

    const result = asBenzeneResult(response, serializer);

    expect(result.status).toBe(BenzeneResultStatus.validationError);
    expect(result.isSuccessful).toBe(false);
    expect(result.errors).toEqual([
      { message: 'Name must not be empty', field: '/name', code: 'NotEmpty' },
      { message: 'Age must be positive', field: '/age', code: 'Positive' },
    ]);
  });

  it('falls back to a single message-only error from detail when errors is absent (older producer)', () => {
    const body = serializer.serialize({ benzeneStatus: BenzeneResultStatus.notFound, detail: 'some-error' });
    const response = new BenzeneMessageClientResponse(BenzeneResultStatus.notFound, body, {}, false);

    const result = asBenzeneResult(response, serializer);

    expect(result.errors).toEqual([{ message: 'some-error' }]);
  });

  it('works over a numeric HTTP status code envelope too', () => {
    const body = serializer.serialize({ detail: 'some-error' });

    const result = asBenzeneResult(new BenzeneMessageClientResponse('422', body), serializer);

    expect(result.status).toBe(BenzeneResultStatus.validationError);
    expect(result.errors).toEqual([{ message: 'some-error' }]);
  });

  it('attaches the received document verbatim, so ProblemTypes.from returns what was received', () => {
    // The received document — an application-owned `type` included — must survive, not be re-derived.
    const body = serializer.serialize({
      type: 'https://example.com/problems/order-already-shipped',
      title: 'Order already shipped',
      benzeneStatus: 'order-already-shipped',
      detail: 'too late',
    });
    const response = new BenzeneMessageClientResponse(BenzeneResultStatus.conflict, body, {}, false);

    const result = asBenzeneResult(response, serializer);
    const problem = ProblemTypes.from(result);

    expect(problem.type).toBe('https://example.com/problems/order-already-shipped');
    expect(problem.title).toBe('Order already shipped');
    expect(problem.detail).toBe('too late');
    // The result's status stays the envelope's classification, never re-derived from the document's
    // benzeneStatus (which can disagree for a still-transitioning producer).
    expect(result.status).toBe(BenzeneResultStatus.conflict);
  });

  it('degrades to the historical error-less failure on an empty or non-JSON body', () => {
    const empty = asBenzeneResult(
      new BenzeneMessageClientResponse(BenzeneResultStatus.notFound, '', {}, false),
      serializer,
    );
    expect(empty.isSuccessful).toBe(false);
    expect(empty.errors).toEqual([]);

    const garbage = asBenzeneResult(
      new BenzeneMessageClientResponse(BenzeneResultStatus.serviceUnavailable, '<html>502</html>', {}, false),
      serializer,
    );
    expect(garbage.isSuccessful).toBe(false);
    expect(garbage.status).toBe(BenzeneResultStatus.serviceUnavailable);
    expect(garbage.errors).toEqual([]);

    // A JSON scalar body is not a problem document either.
    const scalar = asBenzeneResult(
      new BenzeneMessageClientResponse(BenzeneResultStatus.notFound, '"just a string"', {}, false),
      serializer,
    );
    expect(scalar.errors).toEqual([]);
  });
});
