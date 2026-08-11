/** Port of Benzene.Azure.Function.Core (barrel). */
export * from './IAzureFunctionApp';
export * from './AzureFunctionApp';
export * from './IAzureFunctionAppBuilder';
export * from './AzureFunctionAppBuilder';
export * from './AzureFunctionApplicationBuilder';
export * from './AzureFunctionStartUpRunner';
export * from './AzureFunctionHost';
export * from './InlineAzureFunctionStartUp';

// The host-neutral bootstrap (`AzureFunctionApplicationBuilder` + `useAzureFunctions` +
// `AzureFunctionStartUpRunner` + `AzureFunctionHost`) is now ported — the Azure counterpart of the AWS
// `AwsLambdaApplicationBuilder` / `useAwsLambda` / `AwsLambdaStartUpRunner` / `AwsLambdaHost`. The .NET
// `HostBuilderExtensions.UseBenzene<TStartUp>` / `FunctionsWorkerApplicationBuilderExtensions.UseBenzene`
// are `Microsoft.Extensions.Hosting` / isolated-worker-pipeline wrappers with no Node equivalent; the
// runtime binding they perform is instead the `@azure/functions` `app.http(...)` / `app.serviceBusQueue(...)`
// registration a developer writes against a host getter. The per-trigger native-handler getters
// (`.httpFunction`, `.serviceBusFunction`, `.eventHubFunction`) are added to `AzureFunctionHost` by the
// transport packages (see each package's `AzureFunctionHostExtensions`), keeping core transport-agnostic.
