import { describe, expect, it } from 'vitest';
import { ExecutionAlreadyExists, SFNClient } from '@aws-sdk/client-sfn';
import { IServiceResolver } from '@benzene/abstractions';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { HealthCheckMode } from '@benzene/health-checks-core';
import {
  addStepFunctionsClient,
  IStepFunctionsClient,
  StepFunctionsClient,
  StepFunctionsHealthCheck,
} from '@benzene/clients-aws-step-functions';

/**
 * Port of the C# Benzene.Clients.Aws.StepFunctions tests: the client starts an execution with the
 * serialized message + (sanitized) idempotency name, treats an ExecutionAlreadyExists as an idempotent
 * success, and reports other failures as service-unavailable; plus the DI registration and the
 * reachability health check. `IAmazonStepFunctions` is a capturing fake `SFNClient`.
 */

interface SentCommand {
  name: string;
  input: Record<string, unknown>;
}

function capturingSfn(behaviour?: (command: unknown) => Promise<unknown>): {
  commands: SentCommand[];
  client: SFNClient;
} {
  const commands: SentCommand[] = [];
  const client = {
    send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      commands.push({ name: command.constructor.name, input: command.input });
      return behaviour ? behaviour(command) : Promise.resolve({ $metadata: { httpStatusCode: 200 } });
    },
  } as unknown as SFNClient;
  return { commands, client };
}

const noopLogger = { logError: () => {} } as unknown as import('@benzene/abstractions').ILogger;

describe('StepFunctionsClient', () => {
  it('starts an execution with the serialized message as input and returns accepted', async () => {
    const { commands, client } = capturingSfn();
    const sut = new StepFunctionsClient('arn:sm:orders', client, noopLogger);

    const result = await sut.startExecutionAsync<{ orderId: string }, void>({ orderId: 'o1' });

    expect(result.isSuccessful).toBe(true);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe('StartExecutionCommand');
    expect(commands[0]!.input['stateMachineArn']).toBe('arn:sm:orders');
    expect(JSON.parse(commands[0]!.input['input'] as string)).toEqual({ orderId: 'o1' });
    // No execution name supplied -> AWS generates one.
    expect(commands[0]!.input['name']).toBeUndefined();
  });

  it('sanitizes a supplied idempotency name (disallowed chars -> "-", capped at 80)', async () => {
    const { commands, client } = capturingSfn();
    const sut = new StepFunctionsClient('arn:sm:orders', client, noopLogger);

    // Each disallowed char maps to its own '-' (no collapsing): '/', ' ' and '#' -> three dashes.
    await sut.startExecutionAsync<unknown, void>({}, 'order/42 #a');
    expect(commands[0]!.input['name']).toBe('order-42--a');

    commands.length = 0;
    await sut.startExecutionAsync<unknown, void>({}, 'x'.repeat(100));
    expect((commands[0]!.input['name'] as string).length).toBe(80);
  });

  it('treats an ExecutionAlreadyExists as an idempotent success', async () => {
    const { client } = capturingSfn(() =>
      Promise.reject(new ExecutionAlreadyExists({ message: 'exists', $metadata: {} })),
    );
    const sut = new StepFunctionsClient('arn:sm:orders', client, noopLogger);

    const result = await sut.startExecutionAsync<unknown, void>({}, 'dup-token');

    expect(result.isSuccessful).toBe(true);
  });

  it('reports a service-unavailable result when starting the execution throws', async () => {
    const { client } = capturingSfn(() => Promise.reject(new Error('boom')));
    const sut = new StepFunctionsClient('arn:sm:orders', client, noopLogger);

    const result = await sut.startExecutionAsync<unknown, void>({});

    expect(result.isSuccessful).toBe(false);
  });
});

describe('addStepFunctionsClient', () => {
  it('registers a resolvable IStepFunctionsClient that starts executions', async () => {
    const { commands, client } = capturingSfn();
    const container = new DefaultBenzeneServiceContainer();
    addStepFunctionsClient(container, 'arn:sm:orders', client, false);

    const resolver: IServiceResolver = container.createServiceResolverFactory().createScope();
    const sfClient = resolver.getService(IStepFunctionsClient);
    const result = await sfClient.startExecutionAsync<{ orderId: string }, void>({ orderId: 'o2' });

    expect(result.isSuccessful).toBe(true);
    expect(commands[0]!.input['stateMachineArn']).toBe('arn:sm:orders');
  });
});

describe('StepFunctionsHealthCheck', () => {
  it('reachability mode runs a read-only DescribeStateMachine and reports the state machine', async () => {
    const { commands, client } = capturingSfn();
    const result = await new StepFunctionsHealthCheck('arn:sm:orders', client).executeAsync();

    expect(commands[0]!.name).toBe('DescribeStateMachineCommand');
    expect(result.type).toBe('StepFunctions');
    expect(result.data['StateMachineArn']).toBe('arn:sm:orders');
  });

  it('active mode starts a real execution', async () => {
    const { commands, client } = capturingSfn();
    const result = await new StepFunctionsHealthCheck('arn:sm:orders', client, HealthCheckMode.active).executeAsync();

    expect(commands[0]!.name).toBe('StartExecutionCommand');
    expect(result.type).toBe('StepFunctions.Active');
  });
});
