/** Port of Benzene.Azure.Function.BlobStorage.BlobStorageContext. */
import { BlobTriggerEvent } from './BlobTriggerEvent';

/**
 * Provides the middleware pipeline context for a single blob within an Azure Functions blob trigger
 * invocation.
 *
 * FAITHFUL to the C#: unlike the routed transports, `BlobStorageContext` does NOT implement
 * `IHasMessageResult` — a blob is a file, not a message envelope, so nothing routes and nothing records
 * a routed-handler result.
 */
export class BlobStorageContext {
  /**
   * @param blob The delivered blob.
   */
  constructor(blob: BlobTriggerEvent) {
    this.blob = blob;
  }

  /** The delivered blob. */
  readonly blob: BlobTriggerEvent;
}
