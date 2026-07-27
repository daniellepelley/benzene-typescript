import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { SNSClient } from '@aws-sdk/client-sns';
import { addDependencyHealthCheck, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { OutboundSnsContextConverter } from './OutboundSnsContextConverter';
import { SnsClientMiddleware } from './SnsClientMiddleware';
import { SnsHealthCheck } from './SnsHealthCheck';
import { SnsSendMessageContext } from './SnsSendMessageContext';

/**
 * Port of Benzene.Clients.Aws.Sns.Extensions (fluent extension methods -> builder-first free functions).
 * PORT DIVERGENCE: the `SNSClient` is passed explicitly rather than resolved from the container (see the
 * SQS package's note).
 */
export function useSnsClient(
  app: IMiddlewarePipelineBuilder<SnsSendMessageContext>,
  amazonSns: SNSClient,
): IMiddlewarePipelineBuilder<SnsSendMessageContext> {
  return app.use(() => new SnsClientMiddleware(amazonSns));
}

/** Converts an outbound route pipeline to publish via SNS (the routed message becomes the SNS message). */
export function useSns(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  topicArn: string,
  amazonSns: SNSClient,
  topicAttributeKey: string = OutboundSnsContextConverter.DefaultTopicAttribute,
  healthCheck = true,
): IMiddlewarePipelineBuilder<OutboundContext> {
  // Auto-register a non-destructive SNS reachability check for the topic on the DEPENDENCY category
  // (deep healthcheck layer / mesh only, never a Kubernetes probe). Deduped by `Sns:<topicArn>`; reuses
  // this pipeline's `SNSClient`. Pass `healthCheck: false` to opt out. Mirrors .NET's `UseSns`.
  if (healthCheck) {
    app.register((container) =>
      addDependencyHealthCheck(container, () => new SnsHealthCheck(topicArn, amazonSns), `Sns:${topicArn}`),
    );
  }
  return app.convert(new OutboundSnsContextConverter(topicArn, topicAttributeKey), (builder) =>
    useSnsClient(builder, amazonSns),
  );
}

/**
 * Adds an SNS topic health check to a health-check builder explicitly — a non-destructive read-only
 * `GetTopicAttributes` probe. Mirrors .NET's `AddSnsHealthCheck` (takes the `SNSClient` explicitly).
 */
export function addSnsHealthCheck(
  builder: IHealthCheckBuilder,
  topicArn: string,
  amazonSns: SNSClient,
): IHealthCheckBuilder {
  return builder.addHealthCheckFn(() => new SnsHealthCheck(topicArn, amazonSns));
}
