import { BenzeneResultStatus } from '@benzenejs/results';
import { IHttpStatusCodeMapper } from './IHttpStatusCodeMapper';

/**
 * The default Benzene-status -> HTTP-status mapping following standard REST conventions. Unknown or
 * `undefined` statuses default to `"500"`.
 * Port of Benzene.Http.DefaultHttpStatusCodeMapper (C# `null` maps to `undefined`).
 *
 * This IS the status-string -> numeric-HTTP-code translation the API Gateway response chain relies on:
 * `HttpStatusCodeResponseHandler` calls this to turn `IMessageHandlerResult.benzeneResult.status`
 * (e.g. `"Ok"`, `"NotFound"`) into a code string (`"200"`, `"404"`) which `ApiGatewayResponseAdapter`
 * then stores as the numeric `APIGatewayProxyResult.statusCode`.
 */
export class DefaultHttpStatusCodeMapper implements IHttpStatusCodeMapper {
  private static readonly defaultValue = '500';

  private readonly dictionary: Record<string, string> = {
    [BenzeneResultStatus.ok]: '200',
    [BenzeneResultStatus.ignored]: '200',
    [BenzeneResultStatus.created]: '201',
    [BenzeneResultStatus.accepted]: '202',
    [BenzeneResultStatus.updated]: '204',
    [BenzeneResultStatus.deleted]: '204',
    [BenzeneResultStatus.badRequest]: '400',
    [BenzeneResultStatus.unauthorized]: '401',
    [BenzeneResultStatus.forbidden]: '403',
    [BenzeneResultStatus.notFound]: '404',
    [BenzeneResultStatus.conflict]: '409',
    [BenzeneResultStatus.validationError]: '422',
    [BenzeneResultStatus.tooManyRequests]: '429',
    [BenzeneResultStatus.unexpectedError]: '500',
    [BenzeneResultStatus.notImplemented]: '501',
    [BenzeneResultStatus.serviceUnavailable]: '503',
    [BenzeneResultStatus.timeout]: '504',
  };

  /**
   * @param isSuccessful The result's authoritative success flag. Consulted only when
   * `benzeneResultStatus` is outside the table above: an application-defined *successful* status maps
   * to `"200"` instead of the generic-error `"500"` row (wire-contracts.md §4.1). Omitted (C#'s
   * status-only overload) it behaves as `false`, i.e. an unknown status falls to `"500"`.
   */
  map(benzeneResultStatus: string | undefined, isSuccessful?: boolean): string {
    if (benzeneResultStatus !== undefined && benzeneResultStatus in this.dictionary) {
      return this.dictionary[benzeneResultStatus];
    }

    return isSuccessful === true ? '200' : DefaultHttpStatusCodeMapper.defaultValue;
  }
}
