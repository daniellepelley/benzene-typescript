import { Metadata, status } from '@grpc/grpc-js';
import { BenzeneResultStatus } from '@benzenejs/results';
import { IGrpcStatusReverseMapper } from './IGrpcStatusReverseMapper';

/**
 * Port of Benzene.Grpc.Client.DefaultGrpcStatusReverseMapper.
 *
 * The default mapping from gRPC status codes back to Benzene result statuses — the exact inverse of
 * `@benzenejs/grpc`'s {@link DefaultGrpcStatusCodeMapper}. Several Benzene statuses (`created`, `accepted`,
 * `updated`, ...) collapse to `status.OK` on the way out, so on the way back `status.OK` only ever
 * recovers as `BenzeneResultStatus.ok` unless a `benzene-status` trailer says otherwise. Unknown status
 * codes default to `BenzeneResultStatus.unexpectedError` (C# `BenzeneResultStatus.UnexpectedError`).
 *
 * grpc-js's `status` enum matches `Grpc.Core.StatusCode` name-for-name and value-for-value, so the table
 * is a direct transliteration of the C# dictionary.
 */
export class DefaultGrpcStatusReverseMapper implements IGrpcStatusReverseMapper {
  private static readonly TrailerKey = 'benzene-status';

  private readonly dictionary: Partial<Record<status, string>> = {
    [status.OK]: BenzeneResultStatus.ok,
    [status.INVALID_ARGUMENT]: BenzeneResultStatus.badRequest,
    [status.UNAUTHENTICATED]: BenzeneResultStatus.unauthorized,
    [status.PERMISSION_DENIED]: BenzeneResultStatus.forbidden,
    [status.NOT_FOUND]: BenzeneResultStatus.notFound,
    [status.ALREADY_EXISTS]: BenzeneResultStatus.conflict,
    [status.UNIMPLEMENTED]: BenzeneResultStatus.notImplemented,
    [status.UNAVAILABLE]: BenzeneResultStatus.serviceUnavailable,
    [status.RESOURCE_EXHAUSTED]: BenzeneResultStatus.tooManyRequests,
    [status.DEADLINE_EXCEEDED]: BenzeneResultStatus.timeout,
    [status.CANCELLED]: BenzeneResultStatus.serviceUnavailable,
  };

  map(statusCode: status, trailers: Metadata | undefined): string {
    const trailerStatus = this.readTrailerStatus(trailers);
    if (trailerStatus) {
      return trailerStatus;
    }

    return this.dictionary[statusCode] ?? BenzeneResultStatus.unexpectedError;
  }

  private readTrailerStatus(trailers: Metadata | undefined): string | undefined {
    // The `benzene-status` key is not a `-bin` key, so its values are strings (mirroring the C#
    // `!x.IsBinary` filter). Take the first entry, matching C# `FirstOrDefault`.
    const values = trailers?.get(DefaultGrpcStatusReverseMapper.TrailerKey);
    const first = values && values.length > 0 ? values[0] : undefined;
    return typeof first === 'string' && first.length > 0 ? first : undefined;
  }
}
