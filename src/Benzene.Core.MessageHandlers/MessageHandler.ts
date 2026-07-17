import { IBenzeneResult, ILogger } from '@benzene/abstractions';
import {
  IExecutableMessageHandler,
  IMessageHandler,
  IRequestMapperThunk,
} from '@benzene/abstractions-message-handlers';
import { ArgumentException } from '@benzene/core';
import { BenzeneResult } from '@benzene/results';
import { IDefaultStatuses } from './MessageResult';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Binds a typed handler to the request-mapping thunk and translates outcomes and
 * errors into results. Port of Benzene.Core.MessageHandlers.MessageHandler&lt;TRequest, TResponse&gt;.
 *
 * The C# `catch (ArgumentException)` → ValidationError mapping is preserved via
 * the ported ArgumentException class; a handler resolving `undefined` maps to
 * Accepted, which also covers no-response handlers (the C# null-result path).
 */
export class MessageHandler<TRequest, TResponse> implements IExecutableMessageHandler {
  constructor(
    private readonly inner: IMessageHandler<TRequest, TResponse>,
    private readonly logger: ILogger,
    private readonly defaultStatuses: IDefaultStatuses,
  ) {}

  async handlerAsync(requestMapperThunk: IRequestMapperThunk): Promise<IBenzeneResult> {
    let messageObject: TRequest;
    try {
      messageObject = requestMapperThunk.getRequest<TRequest>() as TRequest;
    } catch (error) {
      this.logger.logWarning(`Message is not valid: ${errorMessage(error)}`);
      return BenzeneResult.setErrors(
        this.defaultStatuses.badRequest,
        'Message is not valid',
        errorMessage(error),
      );
    }

    try {
      const result = await this.inner.handleAsync(messageObject);
      if (result === undefined || result === null) {
        return BenzeneResult.accepted();
      }

      return result;
    } catch (error) {
      if (error instanceof ArgumentException) {
        this.logger.logError(error, 'Message handler threw argument exception');
        return BenzeneResult.setErrors(this.defaultStatuses.validationError, errorMessage(error));
      }

      this.logger.logError(error, 'Message handler threw an exception');
      return BenzeneResult.serviceUnavailable(
        'Message handler threw an exception',
        errorMessage(error),
      );
    }
  }
}
