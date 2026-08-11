import { BenzeneStartUp } from '@benzene/abstractions-middleware';
import { Context, Handler } from 'aws-lambda';
import { AwsLambdaEntryPoint } from './AwsLambdaEntryPoint';
import { AwsLambdaStartUpRunner } from './AwsLambdaStartUpRunner';
import { IAwsLambdaEntryPoint } from './IAwsLambdaEntryPoint';
import { toLambdaHandler } from './toLambdaHandler';

/**
 * Port of Benzene.Aws.Lambda.Core.AwsLambdaHost&lt;TStartUp&gt;.
 *
 * Hosts a platform-neutral {@link BenzeneStartUp} as an AWS Lambda entry point. Construct it with your
 * startup class and export its {@link lambdaHandler}:
 *
 * ```ts
 * import { AwsLambdaHost } from '@benzene/aws-lambda-core';
 * import { StartUp } from './startUp';
 * export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
 * ```
 *
 * This is the one-liner boot that replaces the hand-built pipeline assembly: it constructs `TStartUp`,
 * runs `getConfiguration` → `configureServices` → `configure` (via the shared
 * {@link AwsLambdaStartUpRunner}, the SAME sequence `benzeneTestHost(StartUp).buildAwsLambdaHost()` runs
 * in tests), and exposes the correctly-bound `handler` AWS invokes.
 *
 * SDK-MODEL ADAPTATION: the .NET host IS the entry point — AWS reflection-invokes its
 * `FunctionHandlerAsync`, so `class Function : AwsLambdaHost<StartUp> { }` is the deployed handler. Node's
 * runtime invokes an exported `handler` function instead, so this host EXPOSES that handler via
 * {@link lambdaHandler} (a closure bound through `toLambdaHandler`, avoiding the detached-`this` trap of
 * `export const handler = host.functionHandlerAsync`) rather than being it — the same shape as
 * `GoogleCloudFunctionHost.httpFunction`. `functionHandlerAsync` remains for fidelity and direct testing.
 */
export class AwsLambdaHost<TStartUp extends BenzeneStartUp> implements IAwsLambdaEntryPoint {
  private readonly entryPoint: AwsLambdaEntryPoint;
  private readonly boundHandler: Handler;

  /**
   * Constructs `TStartUp`, runs its `getConfiguration`/`configureServices`/`configure`, and builds the
   * entry point every invocation dispatches through.
   *
   * @param startUpFactory A no-argument constructor for the startup — the port of C#'s
   *   `where TStartUp : BenzeneStartUp, new()`.
   */
  constructor(startUpFactory: new () => TStartUp) {
    this.entryPoint = AwsLambdaStartUpRunner.bootstrap(startUpFactory);
    this.boundHandler = toLambdaHandler(this.entryPoint);
  }

  /**
   * The Lambda `handler` to export: `export const handler = new AwsLambdaHost(StartUp).lambdaHandler`. A
   * closure bound to this host (so `this` stays attached), matching the exported-handler shape a Node
   * Lambda developer expects. Port of the deployed C# `AwsLambdaHost::FunctionHandlerAsync` entry point.
   */
  get lambdaHandler(): Handler {
    return this.boundHandler;
  }

  /**
   * Handles a single Lambda invocation. Port of C# `FunctionHandlerAsync(Stream, ILambdaContext)` (the
   * Node runtime hands an already-parsed event and expects a value back — see {@link AwsLambdaEntryPoint}
   * for the stream → parsed-event adaptation). Prefer {@link lambdaHandler} for the exported handler;
   * this remains for fidelity and direct testing.
   */
  functionHandlerAsync(event: unknown, lambdaContext: Context): Promise<unknown> {
    return this.entryPoint.functionHandlerAsync(event, lambdaContext);
  }

  /** Disposes the underlying entry point (and, transitively, its service resolver factory). */
  dispose(): void {
    this.entryPoint.dispose();
  }
}
