import { ILogContextBuilder, LogContextBuilderExtensions } from '@benzene/abstractions';
import { ApiGatewayContext } from './ApiGatewayContext';

const { onRequest } = LogContextBuilderExtensions;

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.LogContextBuilderExtensions (C# fluent extension method ->
 * free function taking the builder as the first argument).
 *
 * Adds the request path and HTTP method to the log context. Uses the ported `onRequest` free
 * function (the C# fluent `OnRequest(key, (_, context) => ...)` extension). .NET-PascalCase ->
 * Node-camelCase: `apiGatewayProxyRequest.path` / `.httpMethod`.
 */
export function withHttp(
  source: ILogContextBuilder<ApiGatewayContext>,
): ILogContextBuilder<ApiGatewayContext> {
  return onRequest(
    onRequest(source, 'path', (_resolver, context) => context.apiGatewayProxyRequest.path),
    'method',
    (_resolver, context) => context.apiGatewayProxyRequest.httpMethod,
  );
}
