import {
  IBenzeneResponseAdapter,
  IMessageHandlerResult,
  IResponseHandler,
} from '@benzene/abstractions-message-handlers';
import { IHttpStatusCodeMapper } from './IHttpStatusCodeMapper';

/**
 * `IResponseHandler<TContext>` that sets the HTTP status code on the response by mapping the handler
 * result's Benzene status through an `IHttpStatusCodeMapper` and writing it via the response adapter.
 * Port of Benzene.Http.HttpStatusCodeResponseHandler&lt;TContext&gt; (C# `ValueTask` maps to `Promise<void>`).
 *
 * This replaces the `BenzeneMessage` transport's `DefaultResponseStatusHandler` for HTTP transports:
 * rather than copying the raw status string onto the response, it translates it to a numeric HTTP
 * code string first (`"Ok"` -> `"200"`, `"NotFound"` -> `"404"`, ...).
 */
export class HttpStatusCodeResponseHandler<TContext> implements IResponseHandler<TContext> {
  constructor(
    private readonly benzeneResponseAdapter: IBenzeneResponseAdapter<TContext>,
    private readonly httpStatusCodeMapper: IHttpStatusCodeMapper,
  ) {}

  handleAsync(context: TContext, messageHandlerResult: IMessageHandlerResult): Promise<void> {
    this.benzeneResponseAdapter.setStatusCode(
      context,
      this.httpStatusCodeMapper.map(messageHandlerResult.benzeneResult.status),
    );
    return Promise.resolve();
  }
}
