/**
 * `@benzenejs/google-cloud-functions-core` — the thin shared foundation for Benzene's Google Cloud
 * Functions integration. Provides the bootstrap steps every Google Cloud Functions trigger-type package
 * (`@benzenejs/google-cloud-functions-http`, `@benzenejs/google-cloud-functions-pubsub`) needs to run a
 * startup. Port of Benzene.GoogleCloud.Functions.Core; not a transport adapter itself.
 */
export * from './GoogleCloudStartUpRunner';
export * from './Extensions';
