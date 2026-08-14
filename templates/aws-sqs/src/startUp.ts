import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import {
  BenzeneConfiguration,
  BenzeneStartUp,
  IBenzeneApplicationBuilder,
} from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useSqs } from '@benzenejs/aws-lambda-sqs';
import { ConsoleGreeter, IGreeter } from './greeter';
import { HelloWorldMessageHandler } from './helloWorldMessageHandler';

/**
 * The composition root. `StartUp` is the single place your service is wired: `configureServices`
 * registers the service graph, `configure` wires the transport pipeline(s). The SAME `StartUp` is booted
 * both by the real Lambda host (`new AwsLambdaHost(StartUp)` in `src/handler.ts`) and by the component
 * test (`benzeneTestHost(StartUp).buildAwsLambdaHost()`), so what the test exercises is exactly what
 * deploys.
 *
 * `BenzeneStartUp` is the platform-neutral contract every Benzene host boots from — the same shape on
 * every cloud. `configure` receives the unified `IBenzeneApplicationBuilder`; you choose the transport(s)
 * inside it with `useAwsLambda(app, aws => …)`. Configuration is the small `BenzeneConfiguration`
 * key/value lookup (the component test layers overrides on top with `.withConfiguration(...)`).
 */
export class StartUp implements BenzeneStartUp {
  getConfiguration(): BenzeneConfiguration {
    return { get: (key) => process.env[key] };
  }

  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    // Register your application services here — a test can override any of them (see `test/`).
    // `IGreeter` is the demo handler's one dependency.
    services.addSingleton(IGreeter, ConsoleGreeter);

    // `addBenzene` registers Benzene's baseline services. `useMessageHandlers` (in `configure`) also
    // ensures it idempotently, so this is belt-and-braces — keep it as the explicit composition root.
    addBenzene(services);
  }

  // This is the one place that's specific to SQS — add `useApiGateway(aws, ...)` / `useSns(aws, ...)`
  // alongside `useSqs(...)` if this function should also handle other AWS event sources.
  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) =>
      useSqs(aws, (sqs) => useMessageHandlers(sqs, HelloWorldMessageHandler)),
    );
  }
}
