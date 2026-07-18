import { Constructor, ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Maps a handler/request/result triple to the validation status string that should be reported.
 * Port of Benzene.Abstractions.Validation.IValidationStatusMapper.
 *
 * Deviations:
 * - C# `GetStatus(Type? handlerType, Type requestType, object? result)`: the `Type` arguments become
 *   `Constructor<unknown>` runtime identifiers (`Type?` → `Constructor<unknown> | undefined`), and
 *   `object?` → `unknown`.
 * - `requestType` is additionally made optional (`Constructor<unknown> | undefined`). C# passes
 *   `typeof(TRequest)`, a real runtime type; TypeScript erases the generic argument, so schema
 *   adapters have no request type to hand in at the call site and pass `undefined`. Same
 *   erasure-driven relaxation as `IGetTopic.getTopic`.
 *
 * Resolved from the container, so a merged `ServiceToken` of the same name is declared.
 */
export interface IValidationStatusMapper {
  getStatus(
    handlerType: Constructor<unknown> | undefined,
    requestType: Constructor<unknown> | undefined,
    result: unknown,
  ): string;
}

export const IValidationStatusMapper: ServiceToken<IValidationStatusMapper> =
  serviceToken<IValidationStatusMapper>('IValidationStatusMapper');
