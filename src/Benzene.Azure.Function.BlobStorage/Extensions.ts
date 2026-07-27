/** Port of Benzene.Azure.Function.BlobStorage.Extensions. */
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { IAzureFunctionApp } from '@benzene/azure-function-core';
import { BlobStorageContext } from './BlobStorageContext';
import { BlobTriggerEvent } from './BlobTriggerEvent';

/**
 * Adds a terminal blob-processing step that receives the `BlobStorageContext` — the blob counterpart of
 * the streaming engine's `useStream(...)` sugar. The step calls `next` after `process`, exactly as C#.
 *
 * OVERLOAD COLLAPSE: C# has two `UseBlob` overloads — one taking `Func<BlobStorageContext, Task>` and a
 * convenience one taking `Func<BlobTriggerEvent, Task>` (implemented as `UseBlob(context =>
 * process(context.Blob))`). Both are single-argument function types, indistinguishable once TypeScript
 * erases their parameter types, so they cannot coexist as runtime-discriminated overloads. The port
 * keeps the more general `BlobStorageContext` form; the blob is one hop away via `context.blob`, so the
 * convenience overload is expressed as `useBlob(app, (context) => process(context.blob))`.
 *
 * @param app The blob pipeline builder.
 * @param process The delegate that consumes the blob context.
 */
export function useBlob(
  app: IMiddlewarePipelineBuilder<BlobStorageContext>,
  process: (context: BlobStorageContext) => Promise<void> | void,
): IMiddlewarePipelineBuilder<BlobStorageContext> {
  return app.useFn('Blob', async (context, next) => {
    await process(context);
    await next();
  });
}

/**
 * Dispatches a blob trigger delivery to the Azure Function app's blob entry point application. Port of
 * C# `Extensions.HandleBlob`, whose two overloads — content as `byte[]` and content as `string` (UTF-8
 * encoded) — differ by parameter type and so remain distinguishable at runtime here: a `string`
 * argument is UTF-8 encoded via the built-in `TextEncoder`, a `Uint8Array` is passed through.
 *
 * @param source The built Azure Function app to dispatch to.
 * @param name The blob's name (bind the trigger's `{name}` expression).
 * @param content The blob's content — raw bytes (`Uint8Array`) or text (`string`, UTF-8 encoded).
 */
export function handleBlob(
  source: IAzureFunctionApp,
  name: string,
  content: Uint8Array,
): Promise<void>;
export function handleBlob(source: IAzureFunctionApp, name: string, content: string): Promise<void>;
export function handleBlob(
  source: IAzureFunctionApp,
  name: string,
  content: Uint8Array | string,
): Promise<void> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return source.handleAsync(new BlobTriggerEvent(name, bytes));
}
