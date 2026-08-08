import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { useAwsLambda } from '@benzene/aws-lambda-core';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { ConsoleGreeter, IGreeter } from './greeter';
import { HelloWorldMessageHandler } from './helloWorldMessageHandler';

/**
 * A minimal, platform-neutral configuration lookup — the TypeScript counterpart of the role .NET's
 * `IConfiguration` plays for `BenzeneStartUp`. The component test layers overrides on top with
 * `.withConfiguration(...)`.
 */
export interface Configuration {
  get(key: string): string | undefined;
}

/**
 * The composition root. `StartUp` is the single place your service is wired: `configureServices`
 * registers the service graph, `configure` wires the transport pipeline(s). The SAME `StartUp` is booted
 * both by the real Lambda host (`src/handler.ts`) and by the component test
 * (`benzeneTestHost(StartUp).buildAwsLambdaHost()`), so what the test exercises is exactly what deploys.
 *
 * Fidelity note: .NET derives from a `BenzeneStartUp` base class; the platform-neutral host base
 * (`AwsLambdaHost<TStartUp>`) is still being ported, so this is a plain class with the same
 * `configureServices`/`configure` shape — structurally the contract `benzeneTestHost(...)` expects.
 */
export class StartUp {
  getConfiguration(): Configuration {
    return { get: (key) => process.env[key] };
  }

  configureServices(services: IBenzeneServiceContainer, _configuration: Configuration): void {
    // Register your application services here — a test can override any of them (see `test/`).
    // `IGreeter` is the demo handler's one dependency.
    services.addSingleton(IGreeter, ConsoleGreeter);

    // `addBenzene` registers Benzene's baseline services. `useMessageHandlers` (in `configure`) also
    // ensures it idempotently, so this is belt-and-braces — keep it as the explicit composition root.
    addBenzene(services);
  }

  // This is the one place that's specific to SQS — add `useApiGateway(aws, ...)` / `useSns(aws, ...)`
  // alongside `useSqs(...)` if this function should also handle other AWS event sources.
  configure(app: IBenzeneApplicationBuilder, _configuration: Configuration): void {
    useAwsLambda(app, (aws) =>
      useSqs(aws, (sqs) => useMessageHandlers(sqs, HelloWorldMessageHandler)),
    );
  }
}
