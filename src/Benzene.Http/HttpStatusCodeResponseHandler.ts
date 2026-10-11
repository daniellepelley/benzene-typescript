import {
  IBenzeneResponseAdapter,
  IMessageHandlerResult,
  IResponseHandler,
} from '@benzenejs/abstractions-message-handlers';
import { IHttpStatusCodeMapper } from './IHttpStatusCodeMapper';

/**
 * `IResponseHandler<TContext>` that sets the HTTP status code on the response by mapping the handler
 * result's Benzene status through an `IHttpStatusCodeMapper` and writing it via the response adapter.
 * Port of Benzene.Http.HttpStatusCodeResponseHandler&lt;TContext&gt; (C# `ValueTask` maps to `Promise<void>`).
 *
 * This replaces the `BenzeneMessage` transport's `DefaultResponseStatusHandler` for HTTP transports:
 * rather than copying the raw status string onto the response, it translates it to a numeric HTTP
 * code string first (`"Ok"` -> `"200"`, `"NotFound"` -> `"404"`, ...).
 *
 * **Health routes** (transport-bindings §1, wire-contracts §5) are the one place the status line maps a
 * payload field rather than the result's status: a successful health query whose report says
 * `isHealthy: false` answers **503**, with the report as the body, so a load balancer or orchestrator that
 * reads only the status line sees the verdict. A warning check does not flip `isHealthy`, so it stays 200.
 * A health invocation that itself failed maps through the status table as usual.
 */
export class HttpStatusCodeResponseHandler<TContext> implements IResponseHandler<TContext> {
  constructor(
    private readonly benzeneResponseAdapter: IBenzeneResponseAdapter<TContext>,
    private readonly httpStatusCodeMapper: IHttpStatusCodeMapper,
  ) {}

  handleAsync(context: TContext, messageHandlerResult: IMessageHandlerResult): Promise<void> {
    const result = messageHandlerResult.benzeneResult;
    this.benzeneResponseAdapter.setStatusCode(
      context,
      result.isSuccessful && isUnhealthyReport(result.payloadAsObject)
        ? UnhealthyStatusCode
        : this.httpStatusCodeMapper.map(result.status, result.isSuccessful),
    );
    return Promise.resolve();
  }
}

/** The status line of a health route whose report says `isHealthy: false`. */
export const UnhealthyStatusCode = '503';

/**
 * Whether `payload` is a health response (wire-contracts §5: a boolean `isHealthy` beside a
 * `healthChecks` object) whose verdict is unhealthy. Recognised by shape, so it holds for any route mapped
 * to a health topic — the reserved ones and an application's own alias alike.
 */
export function isUnhealthyReport(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const report = payload as { isHealthy?: unknown; healthChecks?: unknown };
  return report.isHealthy === false && typeof report.healthChecks === 'object' && report.healthChecks !== null;
}
