/** Port of Benzene.Azure.Function.Kafka.Extensions. */
import { IAzureFunctionApp } from '@benzene/azure-function-core';
import { KafkaRecord } from './KafkaRecord';

/**
 * Dispatches Kafka trigger events to the Azure Function app's Kafka entry point application. Port of C#
 * `Extensions.HandleKafkaEvents(this IAzureFunctionApp, params KafkaRecord[])`. C# `params` maps to a
 * TypeScript rest parameter; a single record for a non-batched trigger, or a batch for a batched one.
 *
 * @param source The built Azure Function app to dispatch to.
 * @param eventData The Kafka events to handle.
 */
export function handleKafkaEvents(
  source: IAzureFunctionApp,
  ...eventData: KafkaRecord[]
): Promise<void> {
  return source.handleAsync(eventData);
}
