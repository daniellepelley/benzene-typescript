import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  addDependencyHealthCheck,
  HealthCheckMode,
  IHealthCheckBuilder,
} from '@benzene/health-checks-core';
import { OutboundSqsContextConverter } from './OutboundSqsContextConverter';
import { SqsClientMiddleware } from './SqsClientMiddleware';
import { SqsHealthCheck } from './SqsHealthCheck';
import { SqsSendMessageContext } from './SqsSendMessageContext';

/**
 * Port of Benzene.Clients.Aws.Sqs.Extensions (C# fluent extension methods -> free functions taking the
 * builder first).
 *
 * PORT DIVERGENCE: the C# `.UseSqs(queueUrl)` resolves `IAmazonSQS` from the container; the TypeScript port
 * takes the `SQSClient` explicitly (there is no synthetic DI token for the raw AWS SDK client). Pass the
 * `@aws-sdk/client-sqs` `SQSClient` the send should use.
 */

/** Appends the terminal `SqsClientMiddleware` (built from `amazonSqs`) to an SQS send pipeline. */
export function useSqsClient(
  app: IMiddlewarePipelineBuilder<SqsSendMessageContext>,
  amazonSqs: SQSClient,
): IMiddlewarePipelineBuilder<SqsSendMessageContext> {
  return app.use(() => new SqsClientMiddleware(amazonSqs));
}

/**
 * Converts an outbound route pipeline (`OutboundRoutingBuilder.route`) to send via SQS: the routed message
 * becomes the SQS message body, the topic + per-call headers become message attributes.
 */
export function useSqs(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  queueUrl: string,
  amazonSqs: SQSClient,
  topicAttributeKey: string = OutboundSqsContextConverter.DefaultTopicAttribute,
  healthCheck = true,
): IMiddlewarePipelineBuilder<OutboundContext> {
  // Auto-register a non-destructive SQS reachability check for the queue on the DEPENDENCY category, so
  // it surfaces on the deep healthcheck layer (monitoring / mesh) but never on a Kubernetes probe.
  // Deduped by `Sqs:<queueUrl>` so two `useSqs(sameUrl)` calls yield one check; reuses the same
  // `SQSClient` this send pipeline uses. Pass `healthCheck: false` to opt out. Mirrors .NET's `UseSqs`.
  if (healthCheck) {
    app.register((container) =>
      addDependencyHealthCheck(
        container,
        () => new SqsHealthCheck(queueUrl, amazonSqs, HealthCheckMode.reachability, topicAttributeKey),
        `Sqs:${queueUrl}`,
      ),
    );
  }
  return app.convert(new OutboundSqsContextConverter(queueUrl, topicAttributeKey), (builder) =>
    useSqsClient(builder, amazonSqs),
  );
}

/**
 * Adds an SQS queue health check to a health-check builder explicitly. By default
 * (`HealthCheckMode.reachability`) this is a non-destructive read-only `GetQueueAttributes` probe; pass
 * `HealthCheckMode.active` to send a real ping message instead (side-effecting — the queue's consumer
 * must recognise and drop it). Mirrors .NET's `AddSqsHealthCheck`.
 *
 * PORT DIVERGENCE: like `useSqs`, this takes the `SQSClient` explicitly rather than resolving
 * `IAmazonSQS` from DI.
 */
export function addSqsHealthCheck(
  builder: IHealthCheckBuilder,
  queueUrl: string,
  amazonSqs: SQSClient,
  topicAttributeKey: string = OutboundSqsContextConverter.DefaultTopicAttribute,
  mode: HealthCheckMode = HealthCheckMode.reachability,
): IHealthCheckBuilder {
  return builder.addHealthCheckFn(() => new SqsHealthCheck(queueUrl, amazonSqs, mode, topicAttributeKey));
}
