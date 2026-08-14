/** Port of Benzene.Aws.Sqs.Consumer.ISqsClientFactory. */
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { ISqsConsumerClient } from './ISqsConsumerClient';

/** Creates the SQS client {@link SqsConsumer} uses to poll a queue. `IAmazonSQS` → {@link ISqsConsumerClient}. */
export interface ISqsClientFactory {
  create(): ISqsConsumerClient;
}

export const ISqsClientFactory: ServiceToken<ISqsClientFactory> = serviceToken<ISqsClientFactory>('ISqsClientFactory');
