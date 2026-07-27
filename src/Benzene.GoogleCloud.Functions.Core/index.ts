/**
 * `@benzene/google-cloud-functions-core` — the thin shared foundation for Benzene's Google Cloud
 * Functions integration. Provides the bootstrap steps every Google Cloud Functions trigger-type package
 * (`@benzene/google-cloud-functions-http`, `@benzene/google-cloud-functions-pubsub`) needs to run a
 * startup. Port of Benzene.GoogleCloud.Functions.Core; not a transport adapter itself.
 */
export * from './GoogleCloudStartUpRunner';
