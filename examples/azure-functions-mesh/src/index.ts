/**
 * `@benzene-example/azure-functions-mesh` — six chained Cloud Service Azure Functions talking over
 * Service Bus / Event Hub / Event Grid, discovered and aggregated by a seventh mesh Function. See
 * `README.md`.
 */
export * from './startUps';
export * from './wiring';
export * from './eventHubEnvelope';
export * from './localAzureEnvironment';
export * from './mesh/meshAggregation';
export * from './mesh/meshStartUp';

export * as ordersDomain from './domain/orders';
export * as paymentsDomain from './domain/payments';
export * as shippingDomain from './domain/shipping';
export * as inventoryDomain from './domain/inventory';
export * as notificationsDomain from './domain/notifications';
export * as analyticsDomain from './domain/analytics';
