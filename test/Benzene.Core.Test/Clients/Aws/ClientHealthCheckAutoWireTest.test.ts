import { describe, expect, it } from 'vitest';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { OutboundRoutingBuilder } from '@benzenejs/clients';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { IDependencyHealthCheck } from '@benzenejs/health-checks-core';
import { getHealthCheckerBuilder, IHealthCheckFinder } from '@benzenejs/health-checks';
import { useSqs } from '@benzenejs/clients-aws-sqs';
import { useSns } from '@benzenejs/clients-aws-sns';
import { useEventBridge } from '@benzenejs/clients-aws-eventbridge';

/**
 * The AWS send clients come with their own health checks: wiring `useSqs`/`useSns`/`useEventBridge`
 * auto-registers a non-destructive reachability check on the DEPENDENCY category (deep healthcheck /
 * mesh only), deduped per resource, opt-out via `healthCheck: false`.
 */
function stub<T>(): T {
  return { send: () => Promise.resolve({ $metadata: { httpStatusCode: 200 } }) } as unknown as T;
}

function dependencyChecks(configure: (builder: OutboundRoutingBuilder) => void): IDependencyHealthCheck[] {
  const container = new DefaultBenzeneServiceContainer();
  const builder = new OutboundRoutingBuilder(container);
  configure(builder);
  const scope = container.createServiceResolverFactory().createScope();
  const found = scope.getServices(IDependencyHealthCheck);
  scope.dispose();
  return found;
}

describe('AWS client health-check auto-wiring', () => {
  it('useSqs/useSns/useEventBridge each auto-register a dependency reachability check', () => {
    const found = dependencyChecks((builder) => {
      builder.route('payments:capture', (p) => useSqs(p, 'https://sqs/orders', stub<SQSClient>()));
      builder.route('order:placed', (p) => useSns(p, 'arn:aws:sns:::order-placed', stub<SNSClient>()));
      builder.route('payment:captured', (p) => useEventBridge(p, 'orders', stub<EventBridgeClient>(), 'bus'));
    });

    expect(found.map((c) => c.type).sort()).toEqual(['EventBridge', 'Sns', 'Sqs']);
    // Each is non-critical (a downstream blip degrades, not de-services).
    expect(found.every((c) => c.isNonCritical === true)).toBe(true);
  });

  it('honours healthCheck: false to opt out', () => {
    const found = dependencyChecks((builder) => {
      builder.route('payments:capture', (p) =>
        useSqs(p, 'https://sqs/orders', stub<SQSClient>(), undefined, false),
      );
    });
    expect(found).toHaveLength(0);
  });

  it('de-duplicates two sends to the same queue into one dependency check (via the finder)', () => {
    const container = new DefaultBenzeneServiceContainer();
    const builder = new OutboundRoutingBuilder(container);
    builder.route('a', (p) => useSqs(p, 'https://sqs/orders', stub<SQSClient>()));
    builder.route('b', (p) => useSqs(p, 'https://sqs/orders', stub<SQSClient>()));
    // Register the IHealthCheckFinder (whose factory reads getServices) on the same container.
    getHealthCheckerBuilder({ register: (action) => action(container) });

    const scope = container.createServiceResolverFactory().createScope();
    // Two registrations, same `Sqs:<url>` dedupKey — the finder collapses them to one.
    const deduped = scope.getService(IHealthCheckFinder).findDependencyHealthChecks();
    scope.dispose();
    expect(deduped).toHaveLength(1);
  });
});
