import { IBenzeneResult, IServiceResolver } from '@benzene/abstractions';
import {
  IMessageGetter,
  IMessageHandlerResultSetter,
} from '@benzene/abstractions-message-handlers';
import { MessageHandlerDefinition, MessageHandlerResult } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';

/**
 * Shared "middleware short-circuits with a status + detail message" helper for authentication/
 * authorization middleware, matching the exact idiom used elsewhere in this codebase (see
 * `Benzene.HealthChecks`' health-check middleware) for applying a result through an
 * `IMessageHandlerResultSetter<TContext>` - this invents no new wire shape. The `detail` string ends
 * up as the result's single error: `BenzeneResult.unauthorized`/`forbidden` attach it as the error.
 *
 * Port of Benzene.Auth.Core.AuthResults (a C# static class of generic methods -> a const object of
 * generic functions).
 */
export const AuthResults = {
  /**
   * Short-circuits the current message with `Unauthorized` ("caller not authenticated") and the given
   * detail message.
   */
  unauthorizedAsync<TContext>(
    resolver: IServiceResolver,
    context: TContext,
    detail: string,
  ): Promise<void> {
    return setResultAsync(resolver, context, BenzeneResult.unauthorized(detail));
  },

  /**
   * Short-circuits the current message with `Forbidden` ("caller authenticated but not permitted")
   * and the given detail message.
   */
  forbiddenAsync<TContext>(
    resolver: IServiceResolver,
    context: TContext,
    detail: string,
  ): Promise<void> {
    return setResultAsync(resolver, context, BenzeneResult.forbidden(detail));
  },
};

function setResultAsync<TContext>(
  resolver: IServiceResolver,
  context: TContext,
  benzeneResult: IBenzeneResult,
): Promise<void> {
  const resultSetter = resolver.getService(
    IMessageHandlerResultSetter,
  ) as unknown as IMessageHandlerResultSetter<TContext>;

  // No specific handler ran - this middleware short-circuited before routing got that far - so report
  // the real incoming topic (same idiom as the health-check middleware) with an empty definition.
  const messageGetter = resolver.getService(IMessageGetter) as unknown as IMessageGetter<TContext>;
  const topic = messageGetter.getTopic(context);

  return resultSetter.setResultAsync(
    context,
    new MessageHandlerResult(topic, MessageHandlerDefinition.empty(), benzeneResult),
  );
}
