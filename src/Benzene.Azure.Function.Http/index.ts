/** Port of Benzene.Azure.Function.AspNet (barrel). Package renamed to @benzene/azure-function-http;
 * every AspNet* type renamed AzureHttp*, retargeted from ASP.NET Core onto the @azure/functions v4
 * HTTP model (see AzureHttpContext for the full rationale and field mapping). */
export * from './AzureHttpContext';
export * from './AzureHttpMessageBodyGetter';
export * from './AzureHttpMessageHeadersGetter';
export * from './AzureHttpMessageTopicGetter';
export * from './AzureHttpHeadersToBodyGetter';
export * from './AzureHttpContextRequestEnricher';
export * from './AzureHttpRequestAdapter';
export * from './AzureHttpResponseAdapter';
export * from './AzureHttpMessageMessageHandlerResultSetter';
export * from './AzureHttpApplication';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// DEFERRED: AspNetRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck)
// — the same registration-diagnostics surface deferred for the AWS SqsRegistrations and Azure
// ServiceBusRegistrations.
