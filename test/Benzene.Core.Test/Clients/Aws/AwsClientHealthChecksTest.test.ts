import { describe, expect, it } from 'vitest';
import { SNSClient } from '@aws-sdk/client-sns';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { HealthCheckStatus } from '@benzene/health-checks-core';
import { SnsHealthCheck } from '@benzene/clients-aws-sns';
import { EventBridgeHealthCheck } from '@benzene/clients-aws-eventbridge';
import { AwsLambdaHealthCheck } from '@benzene/clients-aws-lambda';

/**
 * Each AWS client's health check lives in its own client package (matching .NET). They are
 * non-destructive reachability probes that classify an authorization denial as a persistent failure and
 * never leak the error message. The SDK clients are stubbed — only `send` is exercised.
 */

function stub<T>(send: (command: unknown) => Promise<unknown>): T {
  return { send } as unknown as T;
}
const ok = () => Promise.resolve({ $metadata: { httpStatusCode: 200 } });
const denied = () =>
  Promise.reject(Object.assign(new Error('secret leaked'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));

describe('SnsHealthCheck', () => {
  const arn = 'arn:aws:sns:eu-west-1:123456789012:order-placed';
  it('reports healthy with the Topic dependency', async () => {
    const result = await new SnsHealthCheck(arn, stub<SNSClient>(ok)).executeAsync();
    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.dependencies).toEqual([{ kind: 'Topic', name: arn }]);
  });
  it('classifies a 403 as persistent without leaking the message', async () => {
    const result = await new SnsHealthCheck(arn, stub<SNSClient>(denied)).executeAsync();
    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.isPersistent).toBe(true);
    expect(result.data.RequiredPermission).toBe('sns:GetTopicAttributes');
    expect(JSON.stringify(result.data)).not.toContain('secret leaked');
  });
});

describe('EventBridgeHealthCheck', () => {
  it('reports healthy against a named bus with the EventBus dependency', async () => {
    const result = await new EventBridgeHealthCheck(stub<EventBridgeClient>(ok), 'benzene-ts-mesh-bus').executeAsync();
    expect(result.type).toBe('EventBridge');
    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.dependencies).toEqual([{ kind: 'EventBus', name: 'benzene-ts-mesh-bus' }]);
  });
  it('targets the default bus when none is given', async () => {
    const result = await new EventBridgeHealthCheck(stub<EventBridgeClient>(ok)).executeAsync();
    expect(result.data.EventBus).toBe('default');
  });
  it('classifies an access-denied surfaced as HTTP 400 (by error code) as persistent', async () => {
    const result = await new EventBridgeHealthCheck(
      stub<EventBridgeClient>(() =>
        Promise.reject(Object.assign(new Error('x'), { name: 'AccessDeniedException', $metadata: { httpStatusCode: 400 } })),
      ),
    ).executeAsync();
    expect(result.isPersistent).toBe(true);
  });
});

describe('AwsLambdaHealthCheck', () => {
  it('reports healthy with the Lambda dependency', async () => {
    const result = await new AwsLambdaHealthCheck('orders-api', stub<LambdaClient>(ok)).executeAsync();
    expect(result.type).toBe('Lambda');
    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.dependencies).toEqual([{ kind: 'Lambda', name: 'orders-api' }]);
  });
  it('classifies a denial as persistent with the required permission named', async () => {
    const result = await new AwsLambdaHealthCheck('orders-api', stub<LambdaClient>(denied)).executeAsync();
    expect(result.isPersistent).toBe(true);
    expect(result.data.RequiredPermission).toBe('lambda:GetFunctionConfiguration');
  });
});
