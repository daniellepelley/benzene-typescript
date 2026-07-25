/**
 * `@benzene-example/azure-functions` - one order domain (`src/handlers.ts`, identical to the AWS Lambda
 * example's) hosted on three Azure Functions triggers: HTTP, Service Bus, and Event Hub. The function
 * callbacks are in `src/functions.ts`; the idiomatic `app.http(...)`/`app.serviceBusQueue(...)`/
 * `app.eventHub(...)` registrations are in `src/registrations.ts` (loaded by the host, not by tests).
 * See `README.md`.
 */
export * from './handlers';
export * from './functions';
