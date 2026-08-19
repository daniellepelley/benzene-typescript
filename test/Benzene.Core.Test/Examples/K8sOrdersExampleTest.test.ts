import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BenzeneHost } from '@benzenejs/self-host';
import { OrdersStartUp } from '@benzene-example/k8s-orders';

/**
 * `@benzene-example/k8s-orders` — one handler behind three transports (HTTP via `useExpress`, SQS, Kafka)
 * declared in one `OrdersStartUp` and run by `BenzeneHost.runAsync(OrdersStartUp)`.
 *
 * What is under test is the start-up contract, not the transports: booting the startup must build all
 * three legs WITHOUT contacting a broker (the SQS/Kafka client factories are lazy), and a missing piece
 * of configuration must fail the boot with a message naming the key — not a null dereference on the
 * first polled message.
 */
describe('@benzene-example/k8s-orders', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env['PORT'] = '0';
    process.env['KAFKA_BROKERS'] = 'localhost:9092';
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('boots all three transports without contacting a broker', () => {
    process.env['QUEUE_URL'] = 'http://localhost:4566/000000000000/orders-in';

    expect(BenzeneHost.build(OrdersStartUp)).toBeDefined();
  });

  it('fails start-up naming the missing key when QUEUE_URL is unset', () => {
    delete process.env['QUEUE_URL'];

    expect(() => BenzeneHost.build(OrdersStartUp)).toThrow(/QUEUE_URL is not set/);
  });
});
