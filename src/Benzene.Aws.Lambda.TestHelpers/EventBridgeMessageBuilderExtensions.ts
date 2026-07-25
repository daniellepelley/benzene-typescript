/** Port of Benzene.Aws.Lambda.EventBridge.TestHelpers.MessageBuilderExtensions. */
import { EventBridgeEvent } from 'aws-lambda';
import { IMessageBuilder } from '@benzene/abstractions';

export interface AsEventBridgeOptions {
  /** The event `source` (default `"benzene.test"`). */
  source?: string;
}

/**
 * Builds an `EventBridgeEvent` from a message builder: the topic becomes `detail-type`, the message
 * becomes `detail`, and any headers are embedded under the reserved `_benzeneHeaders` key (only when the
 * message is an object) - the same shape the outbound EventBridge client publishes. Port of
 * `Benzene.Aws.Lambda.EventBridge.TestHelpers.MessageBuilderExtensions.AsEventBridge`.
 */
export function asEventBridge<T>(
  source: IMessageBuilder<T>,
  options: AsEventBridgeOptions = {},
): EventBridgeEvent<string, unknown> {
  const { source: eventSource = 'benzene.test' } = options;

  let detail: unknown = source.message;
  const headerEntries = Object.entries(source.headers);
  if (headerEntries.length > 0 && isPlainObject(source.message)) {
    detail = { ...source.message, _benzeneHeaders: Object.fromEntries(headerEntries) };
  }

  return {
    version: '0',
    id: 'event-1',
    'detail-type': source.topic,
    source: eventSource,
    account: '123456789012',
    time: '2026-01-01T00:00:00Z',
    region: 'eu-west-1',
    resources: [],
    detail,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
