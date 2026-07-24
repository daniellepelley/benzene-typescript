import { IBenzeneResultOf, VoidResult } from '@benzene/abstractions';
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
    readonly errors: string[],
    readonly isSuccessful: boolean,
  ) {}

  get payloadAsObject(): unknown {
    return this.payload;
  }
}

function create<T>(status: string, payload: T, errors: string[] = [], isSuccessful?: boolean): IBenzeneResultOf<T> {
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

  /** Port of C# `Set(status, params string[] errors)`. */
  setErrors<T = VoidResult>(status: string, ...errors: string[]): IBenzeneResultOf<T> {
    return create(status, voidPayload as T, errors);
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

  notFound<T = VoidResult>(...errors: string[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.notFound, ...errors);
  },

  badRequest<T = VoidResult>(...errors: string[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.badRequest, ...errors);
  },

  unauthorized<T = VoidResult>(...errors: string[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.unauthorized, ...errors);
  },

  forbidden<T = VoidResult>(...errors: string[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.forbidden, ...errors);
  },

  validationError<T = VoidResult>(...errors: string[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.validationError, ...errors);
  },

  serviceUnavailable<T = VoidResult>(...errors: string[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.serviceUnavailable, ...errors);
  },

  tooManyRequests<T = VoidResult>(...errors: string[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.tooManyRequests, ...errors);
  },

  unexpectedError<T = VoidResult>(...errors: string[]): IBenzeneResultOf<T> {
    return BenzeneResult.setErrors(BenzeneResultStatus.unexpectedError, ...errors);
  },
} as const;
