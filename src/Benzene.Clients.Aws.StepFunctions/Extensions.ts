import { SFNClient } from '@aws-sdk/client-sfn';
import { IBenzeneServiceContainer, ILoggerFactory, NullLogger } from '@benzenejs/abstractions';
import {
  addDependencyHealthCheck,
  HealthCheckMode,
  IHealthCheckBuilder,
} from '@benzenejs/health-checks-core';
import { IStepFunctionsClient } from './IStepFunctionsClient';
import {
  IStepFunctionsClientFactory,
  StepFunctionsClientFactory,
} from './StepFunctionsClientFactory';
import { StepFunctionsHealthCheck } from './StepFunctionsHealthCheck';

/**
 * Port of Benzene.Clients.Aws.StepFunctions.Extensions (C# fluent extension methods -> free functions
 * taking the container/builder first).
 *
 * PORT DIVERGENCE: the C# `AddStepFunctionsClient` resolves `IAmazonStepFunctions` from the container;
 * the TypeScript port takes the `@aws-sdk/client-sfn` `SFNClient` explicitly (there is no synthetic DI
 * token for the raw AWS SDK client), matching the `@benzenejs/clients-aws-*` siblings.
 */

/**
 * Registers an {@link IStepFunctionsClientFactory} / {@link IStepFunctionsClient} for a fixed state
 * machine, sending via the given `SFNClient`. By default also auto-registers a non-destructive
 * reachability health check (`DescribeStateMachine`) for the state machine on the deep `benzene:healthcheck`
 * layer — never a Kubernetes probe (a broker/service being unreachable is shared-fate). Pass
 * `healthCheck: false` to opt out. Deduped by `StepFunctions:{arn}`.
 */
export function addStepFunctionsClient(
  services: IBenzeneServiceContainer,
  stateMachineArn: string,
  amazonStepFunctions: SFNClient,
  healthCheck = true,
): IBenzeneServiceContainer {
  services.addScopedFactory(
    IStepFunctionsClientFactory,
    (resolver) =>
      new StepFunctionsClientFactory(
        stateMachineArn,
        amazonStepFunctions,
        resolver.tryGetService(ILoggerFactory)?.createLogger('StepFunctionsClient') ?? NullLogger.instance,
      ),
  );
  services.addScopedFactory(IStepFunctionsClient, (resolver) =>
    resolver.getService(IStepFunctionsClientFactory).create(),
  );

  if (healthCheck) {
    addDependencyHealthCheck(
      services,
      () => new StepFunctionsHealthCheck(stateMachineArn, amazonStepFunctions, HealthCheckMode.reachability),
      `StepFunctions:${stateMachineArn}`,
    );
  }

  return services;
}

/**
 * Adds a Step Functions state machine health check to a health-check builder explicitly. By default
 * (`HealthCheckMode.reachability`) this is a non-destructive read-only `DescribeStateMachine` probe; pass
 * `HealthCheckMode.active` to start a real execution instead (side-effecting).
 */
export function addStepFunctionHealthCheck(
  builder: IHealthCheckBuilder,
  stateMachineArn: string,
  amazonStepFunctions: SFNClient,
  mode: HealthCheckMode = HealthCheckMode.reachability,
): IHealthCheckBuilder {
  return builder.addHealthCheckFn(
    () => new StepFunctionsHealthCheck(stateMachineArn, amazonStepFunctions, mode),
  );
}
