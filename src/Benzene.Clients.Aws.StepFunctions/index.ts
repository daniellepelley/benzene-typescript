/**
 * Port of Benzene.Clients.Aws.StepFunctions — the outbound AWS Step Functions client + health check.
 *
 * `addStepFunctionsClient(services, stateMachineArn, sfnClient)` registers an `IStepFunctionsClient`
 * (resolved from the container) whose `startExecutionAsync<TMessage, TResponse>(message, executionName?)`
 * starts a state-machine execution with the serialized message as input — with an optional idempotency
 * name so a retry after a lost response won't start a duplicate. Also auto-wires a non-destructive
 * reachability health check for the state machine (opt out with `healthCheck: false`).
 */
export * from './IStepFunctionsClient';
export * from './StepFunctionsClient';
export * from './StepFunctionsClientFactory';
export * from './StepFunctionsHealthCheck';
export * from './awsErrorDetails';
export * from './Extensions';
