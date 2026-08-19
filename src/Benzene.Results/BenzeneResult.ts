import { BenzeneError, IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { ProblemDetails } from './ProblemDetails';
import { BenzeneResultStatus } from './BenzeneResultStatus';

/**
 * Factory for creating result instances.
 * Port of Benzene.Results.BenzeneResult.
 *
 * The C# generic/non-generic overload pairs (`Ok()` / `Ok<T>(payload)`) collapse
 * into single functions with an optional payload defaulting to `VoidResult`
 * (the port of C# `Void`). The status-specific factories mirror the C# names.
 */
class BenzeneResultInternal<T> implements IBenzeneResultOf<T> {
  constructor(
    readonly status: string,
    readonly payload: T,
    readonly errors: BenzeneError[],
    readonly isSuccessful: boolean,
  ) {}

  get payloadAsObject(): unknown {
    return this.payload;
  }
}

/**
 * Widens the caller's errors to structured {@link BenzeneError}s. A plain string becomes
 * `{ message }` - the shape a message-only failure has always had on the wire - so every existing
 * call site that passes strings is unchanged, while a caller that has a `field` or `code` can now
 * pass those through instead of losing them.
 */
function toBenzeneErrors(errors: readonly (string | BenzeneError)[]): BenzeneError[] {
  return errors.map((error) => (typeof error === 'string' ? { message: error } : error));
}

function create<T>(
  status: string,
  payload: T,
  errors: BenzeneError[] = [],
  isSuccessful?: boolean,
): IBenzeneResultOf<T> {
  return new BenzeneResultInternal(
    status,
    payload,
    errors,
    isSuccessful ?? BenzeneResultStatus.isSuccess(status),
  );
}

const voidPayload = new VoidResult();

export const BenzeneResult = {
  /** Port of the C# `Set` overloads. */
  set<T = VoidResult>(status: string, payload?: T, isSuccessful?: boolean): IBenzeneResultOf<T> {
    return create(status, (payload ?? voidPayload) as T, [], isSuccessful);
  },

  /**
   * Port of C# `Set(status, params BenzeneError[] errors)` and its `string[]` sibling: accepts
   * either, so `setErrors(status, 'a message')` and
   * `setErrors(status, { message: 'a message', field: 'Name', code: 'NotEmpty' })` both work.
   */
  setErrors<T = VoidResult>(
    status: string,
    ...errors: (string | BenzeneError)[]
  ): IBenzeneResultOf<T> {
    return create(status, voidPayload as T, toBenzeneErrors(errors));
  },

  /**
   * Builds a failed result carrying a deliberately-authored problem document - the port of C#
   * `BenzeneResult.Problem<T>(ProblemDetails)`.
   *
   * The status comes from the document's `benzeneStatus`, which is required: a problem document
   * with no status cannot be classified by anything downstream. The result's `errors` are projected
   * from the document's own `errors`, and the result is always unsuccessful - this factory exists
   * to fail deliberately with a richer document than the status-derived one, most often to set an
   * application-owned `type` (wire-contracts.md §1.3).
   */
  problem<T = VoidResult>(problem: ProblemDetails): IBenzeneResultOf<T> {
    if (problem.benzeneStatus === undefined || problem.benzeneStatus === '') {
      throw new Error(
        'problem.benzeneStatus is required to build a BenzeneResult.problem(...) - a problem ' +
          'document with no status cannot be classified by anything downstream. Set ' +
          'ProblemDetails.benzeneStatus before passing it here.',
      );
    }

    const result = create<T>(problem.benzeneStatus, voidPayload as T, [...(problem.errors ?? [])], false);
    // The authored document travels alongside the result so the response mapper emits it verbatim
    // rather than re-deriving one from the status - otherwise an application-owned `type` would be
    // overwritten by the registry URI on the way out.
    (result as { problem?: ProblemDetails }).problem = problem;
    return result;
  },

  ok<T = VoidResult>(payload?: T): IBenzeneResultOf<T> {
    return BenzeneResult.set(BenzeneResultStatus.ok, payload);
  },

  created<T = VoidResult>(payload?: T): IBenzeneResultOf<T> {
    return BenzeneResult.set(BenzeneResultStatus.created, payload);
  },

  accepted<T = VoidResult>(payload?: T): IBenzeneResultOf<T> {
    return BenzeneResult.set(BenzeneResultStatus.accepted, payload);
  },

  updated<T = VoidResult>(payload?: T): IBenzeneResultOf<T> {
    return BenzeneResult.set(BenzeneResultStatus.updated, payload);
  },

  deleted<T = VoidResult>(payload?: T): IBenzeneResultOf<T> {
    return BenzeneResult.set(BenzeneResultStatus.deleted, payload);
  },

  ignored<T = VoidResult>(): IBenzeneResultOf<T> {
    return BenzeneResult.set(BenzeneResultStatus.ignored);
  },

  notFound<T = VoidResult>(...errors: (string | BenzeneError)[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.notFound, ...errors);
  },

  badRequest<T = VoidResult>(...errors: (string | BenzeneError)[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.badRequest, ...errors);
  },

  unauthorized<T = VoidResult>(...errors: (string | BenzeneError)[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.unauthorized, ...errors);
  },

  forbidden<T = VoidResult>(...errors: (string | BenzeneError)[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.forbidden, ...errors);
  },

  validationError<T = VoidResult>(...errors: (string | BenzeneError)[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.validationError, ...errors);
  },

  serviceUnavailable<T = VoidResult>(...errors: (string | BenzeneError)[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.serviceUnavailable, ...errors);
  },

  tooManyRequests<T = VoidResult>(...errors: (string | BenzeneError)[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.tooManyRequests, ...errors);
  },

  unexpectedError<T = VoidResult>(...errors: (string | BenzeneError)[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.unexpectedError, ...errors);
  },
} as const;
