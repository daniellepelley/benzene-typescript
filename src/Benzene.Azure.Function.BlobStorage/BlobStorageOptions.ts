/**
 * Configures how `BlobStorageApplication` settles a blob delivery (transport-bindings §1, obligation 8) —
 * the `blob-storage` **one-shot** binding: an uncaught error fails the invocation, so the Functions host
 * retries the blob (and, after its retry budget, writes it to the `webjobs-blobtrigger-poison` queue).
 *
 * There is no topic routing on this trigger (a blob is consumed with `useBlob(...)`), so there is no
 * result and no unmatched topic to settle — only errors. `atMostOnce` is the override the spec requires.
 *
 * TypeScript-only type (the .NET binding has no options yet).
 */
export class BlobStorageOptions {
  /**
   * The **at-most-once override**: catch and log an uncaught error so the invocation succeeds and the
   * blob is never retried. Defaults to `false`.
   */
  atMostOnce = false;
}
