/**
 * `@benzenejs/google-cloud-functions-http` — host a Benzene HTTP service on Google Cloud Functions Gen2.
 * Port of Benzene.GoogleCloud.Functions.Http.
 *
 * The same startup runs on the Functions Framework HTTP trigger (via {@link GoogleCloudFunctionHost})
 * and, in principle, any other Benzene HTTP host — write it once and point
 * `gcloud functions deploy --entry-point` at the registered function.
 */
export * from './GoogleCloudFunctionApplicationBuilder';
export * from './Extensions';
export * from './GoogleCloudFunctionHost';
