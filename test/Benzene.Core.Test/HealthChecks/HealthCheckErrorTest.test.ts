import { describe, expect, it } from 'vitest';
import { HealthCheckDependency, HealthCheckError, HealthCheckStatus } from '@benzenejs/health-checks-core';

/**
 * Ports Benzene.HealthChecks.Core.HealthCheckError's shared classification policy: an
 * authorization/permission denial is a *persistent* failure (escapes the non-critical downgrade),
 * any other error is a transient failure, and the exception message is never surfaced — only the
 * error name plus the non-sensitive error-code/status-code discriminators.
 */
describe('HealthCheckError', () => {
  const deps = [new HealthCheckDependency('Http', 'stripe-gateway')];

  it('classifies an HTTP 403 as a persistent failure', () => {
    const result = HealthCheckError.classify('PaymentGateway', new Error('boom'), deps, { statusCode: 403 });
    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.isPersistent).toBe(true);
    expect(result.data.StatusCode).toBe(403);
    expect(result.dependencies).toEqual(deps);
  });

  it('classifies a known authorization error code surfaced as HTTP 400 as persistent', () => {
    // AWS EventBridge surfaces AccessDeniedException as HTTP 400 — detection is by meaning, not status.
    const result = HealthCheckError.classify('EventBus', new Error('denied'), deps, {
      errorCode: 'AccessDeniedException',
      statusCode: 400,
    });
    expect(result.isPersistent).toBe(true);
    expect(result.data.ErrorCode).toBe('AccessDeniedException');
  });

  it('classifies a non-authorization failure (e.g. throttling) as transient', () => {
    const result = HealthCheckError.classify('Queue', new Error('slow down'), deps, {
      errorCode: 'ThrottlingException',
      statusCode: 429,
    });
    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.isPersistent).toBe(false);
  });

  it('never surfaces the exception message, only its name', () => {
    const result = HealthCheckError.classify('Db', new TypeError('secret connection string leaked'), deps);
    expect(result.data.Error).toBe('TypeError');
    expect(JSON.stringify(result.data)).not.toContain('secret connection string');
  });

  it('names the required permission on an authorization denial only', () => {
    const denied = HealthCheckError.classify('EventBus', new Error('x'), deps, {
      statusCode: 403,
      requiredPermission: 'events:DescribeEventBus',
    });
    expect(denied.data.RequiredPermission).toBe('events:DescribeEventBus');

    const transient = HealthCheckError.classify('EventBus', new Error('x'), deps, {
      statusCode: 500,
      requiredPermission: 'events:DescribeEventBus',
    });
    expect(transient.data.RequiredPermission).toBeUndefined();
  });

  it('isPermissionStatus / isAuthorizationFailure detect denials by status or code', () => {
    expect(HealthCheckError.isPermissionStatus(401)).toBe(true);
    expect(HealthCheckError.isPermissionStatus(403)).toBe(true);
    expect(HealthCheckError.isPermissionStatus(500)).toBe(false);
    expect(HealthCheckError.isAuthorizationFailure(400, 'AuthorizationError')).toBe(true);
    expect(HealthCheckError.isAuthorizationFailure(404, 'ResourceNotFound')).toBe(false);
  });
});
