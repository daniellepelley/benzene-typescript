import { Handler } from 'aws-lambda';
import { IAwsLambdaEntryPoint } from './IAwsLambdaEntryPoint';

/**
 * Adapts a built `IAwsLambdaEntryPoint` into the exported `handler` AWS invokes:
 *
 * ```ts
 * const entryPoint = new InlineAwsLambdaStartUp()....build();
 * export const handler = toLambdaHandler(entryPoint);
 * ```
 *
 * WHY THIS EXISTS: in .NET the StartUp class *is* the Lambda entry point (AWS reflection-invokes
 * `Namespace.StartUp::FunctionHandlerAsync`), so a `FunctionHandlerAsync` method is exactly right. In
 * Node, AWS invokes an exported `handler` function, and the natural
 * `export const handler = entryPoint.functionHandlerAsync` is a trap: it compiles (it is assignable to
 * `aws-lambda`'s `Handler`) but detaches the method from its instance, so `this.serviceResolverFactory`
 * is `undefined` at the first invocation. This helper returns a closure bound to `entryPoint`, making the
 * pit-of-success the exported-handler shape a TypeScript Lambda developer expects. `functionHandlerAsync`
 * remains for fidelity and direct testing.
 */
export function toLambdaHandler(entryPoint: IAwsLambdaEntryPoint): Handler {
  return (event, context) => entryPoint.functionHandlerAsync(event, context);
}
