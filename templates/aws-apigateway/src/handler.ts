import { AwsLambdaHost } from '@benzene/aws-lambda-core';
import { StartUp } from './startUp';

/**
 * The Lambda entry point AWS invokes. Point your function's handler at `src/handler.handler`
 * (e.g. `Handler: src/handler.handler` in `template.yaml`).
 *
 * `new AwsLambdaHost(StartUp)` builds the pipeline once on module load (cold start) from the shared
 * `StartUp` — the same composition root the component test boots via
 * `benzeneTestHost(StartUp).buildAwsLambdaHost()` — and `.lambdaHandler` is the correctly-bound function
 * AWS calls. Do NOT write `export const handler = host.functionHandlerAsync`; it compiles but detaches
 * `this` and crashes on the first invocation. `.lambdaHandler` is the pit of success.
 */
export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
