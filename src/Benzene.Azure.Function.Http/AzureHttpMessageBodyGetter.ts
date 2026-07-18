import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { AzureHttpContext } from './AzureHttpContext';

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetMessageBodyGetter.
 *
 * Extracts the message body. .NET reads the ASP.NET request body stream synchronously (blocking on
 * `StreamReader.ReadToEndAsync().Result`). `@azure/functions`' body accessors are asynchronous, so the
 * body is read eagerly at the entry point (`handleHttpRequest` `await request.text()`) and stored on
 * the context; this getter returns that already-materialized `body` synchronously, keeping
 * `IMessageBodyGetter.getBody` synchronous. `undefined` maps C#'s `null`-on-failure.
 */
export class AzureHttpMessageBodyGetter implements IMessageBodyGetter<AzureHttpContext> {
  getBody(context: AzureHttpContext): string | undefined {
    return context.body;
  }
}
