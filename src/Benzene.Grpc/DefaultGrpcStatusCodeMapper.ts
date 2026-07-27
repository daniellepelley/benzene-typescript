import { status } from '@grpc/grpc-js';
import { BenzeneResultStatus } from '@benzene/results';
import { IGrpcStatusCodeMapper } from './IGrpcStatusCodeMapper';

/**
 * Port of Benzene.Grpc.DefaultGrpcStatusCodeMapper.
 *
 * The full, faithful Benzene-status → grpc-status mapping table. Unknown or `undefined` statuses default
 * to {@link status.INTERNAL} (C# `StatusCode.Internal`). grpc-js's `status` enum matches
 * `Grpc.Core.StatusCode` name-for-name and value-for-value, so this is a direct transliteration.
 */
export class DefaultGrpcStatusCodeMapper implements IGrpcStatusCodeMapper {
  private static readonly DefaultValue = status.INTERNAL;

  private readonly dictionary: Record<string, status> = {
    [BenzeneResultStatus.ok]: status.OK,
    [BenzeneResultStatus.ignored]: status.OK,
    [BenzeneResultStatus.created]: status.OK,
    [BenzeneResultStatus.accepted]: status.OK,
    [BenzeneResultStatus.updated]: status.OK,
    [BenzeneResultStatus.deleted]: status.OK,
    [BenzeneResultStatus.badRequest]: status.INVALID_ARGUMENT,
    [BenzeneResultStatus.validationError]: status.INVALID_ARGUMENT,
    [BenzeneResultStatus.unauthorized]: status.UNAUTHENTICATED,
    [BenzeneResultStatus.forbidden]: status.PERMISSION_DENIED,
    [BenzeneResultStatus.notFound]: status.NOT_FOUND,
    [BenzeneResultStatus.conflict]: status.ALREADY_EXISTS,
    [BenzeneResultStatus.notImplemented]: status.UNIMPLEMENTED,
    [BenzeneResultStatus.serviceUnavailable]: status.UNAVAILABLE,
    [BenzeneResultStatus.tooManyRequests]: status.RESOURCE_EXHAUSTED,
    [BenzeneResultStatus.timeout]: status.DEADLINE_EXCEEDED,
    [BenzeneResultStatus.unexpectedError]: status.INTERNAL,
  };

  map(benzeneResultStatus: string | undefined): status {
    if (benzeneResultStatus === undefined) {
      return DefaultGrpcStatusCodeMapper.DefaultValue;
    }

    const mapped = this.dictionary[benzeneResultStatus];
    return mapped ?? DefaultGrpcStatusCodeMapper.DefaultValue;
  }
}
