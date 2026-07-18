/** Port of Benzene.Azure.Function.Core (barrel). */
export * from './IAzureFunctionApp';
export * from './AzureFunctionApp';
export * from './IAzureFunctionAppBuilder';
export * from './AzureFunctionAppBuilder';
export * from './InlineAzureFunctionStartUp';

// DEFERRED (unported generic-host / isolated-worker bootstrap — same treatment as the deferred AWS
// AwsLambdaHost / BenzeneApplicationBuilder):
//   - AzureFunctionAppBuilderExtensions.cs (`UseBenzeneInvocation`) — depends on the platform-neutral
//     `IBenzeneApplicationBuilder` and `AddBenzeneInvocation`, neither of which is ported.
//   - HostBuilderExtensions.cs (`UseBenzene<TStartUp>`) — depends on `Microsoft.Extensions.Hosting`
//     `IHostBuilder` and `BenzeneStartUp`.
//   - FunctionsWorkerApplicationBuilderExtensions.cs (`UseBenzene`) — depends on the isolated-worker
//     `IFunctionsWorkerApplicationBuilder` middleware pipeline and `IBenzeneInvocation`.
