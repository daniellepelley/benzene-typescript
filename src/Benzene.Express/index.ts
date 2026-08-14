/**
 * `@benzenejs/express` - run Benzene inside an existing Express (or Connect) app as a piece of middleware:
 * Benzene handles the HTTP verbs + URLs it has `@httpEndpoint` message handlers for, and falls through to
 * the rest of the Express pipeline for everything else. The strangler-fig pattern for gradually
 * introducing a Benzene service into an existing Express codebase.
 *
 * This has no direct C# counterpart to port - `Benzene.AspNet.Core` is ASP.NET Core-specific. Express is
 * the Node/JS host equivalent, adapted per the README's "third-party integrations are adapted, not
 * reimplemented" convention (Express here plays the role ASP.NET Core plays in .NET). The adapter set
 * (context, getters, request/response adapters, enricher, result setter, `addExpress`) is a structural
 * analog of `@benzenejs/aws-lambda-api-gateway`'s; `benzene()` is the entry point.
 */
export * from './types';
export * from './ExpressContext';
export * from './ExpressMessageTopicGetter';
export * from './ExpressMessageBodyGetter';
export * from './ExpressMessageHeadersGetter';
export * from './ExpressHttpRequestAdapter';
export * from './ExpressRequestEnricher';
export * from './ExpressResponseAdapter';
export * from './ExpressMessageMessageHandlerResultSetter';
export * from './DependencyInjectionExtensions';
export * from './Extensions';
