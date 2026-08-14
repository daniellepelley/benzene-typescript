/** Port of Benzene.Azure.Function.BlobStorage.BlobStorageApplication. */
import { IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { EntryPointMiddlewareApplication, MiddlewareApplication } from '@benzenejs/core-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { BlobStorageContext } from './BlobStorageContext';
import { BlobTriggerEvent } from './BlobTriggerEvent';

/**
 * The entry point application for a blob-triggered Azure Function. Maps the delivered blob to a
 * `BlobStorageContext` and runs it through the middleware pipeline, tagging the transport as
 * `"blob-storage"` for the duration.
 *
 * FAITHFUL to the C#: `BlobStorageApplication : EntryPointMiddlewareApplication<BlobTriggerEvent>`
 * wrapping a single-blob `MiddlewareApplication<BlobTriggerEvent, BlobStorageContext>` (NOT a
 * batch/multi application — one blob-trigger function fires per blob) over a
 * `TransportMiddlewarePipeline<BlobStorageContext>("blob-storage", ...)`. All three are already ported;
 * this mirrors the `TimerApplication` single-tick shape. `AzureFunctionApp` dispatches to it via the
 * fire-and-forget `handleAsync` path.
 */
export class BlobStorageApplication extends EntryPointMiddlewareApplication<BlobTriggerEvent> {
  /**
   * @param pipeline The built blob middleware pipeline to run each blob through.
   * @param serviceResolverFactory The service resolver factory used to process each invocation.
   */
  constructor(
    pipeline: IMiddlewarePipeline<BlobStorageContext>,
    serviceResolverFactory: IServiceResolverFactory,
  ) {
    super(
      new MiddlewareApplication<BlobTriggerEvent, BlobStorageContext>(
        new TransportMiddlewarePipeline<BlobStorageContext>(TransportNames.BlobStorage, pipeline),
        (blob) => new BlobStorageContext(blob),
      ),
      serviceResolverFactory,
    );
  }
}
