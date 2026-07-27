/**
 * Port of Benzene.Clients.GoogleCloud.PubSub — the outbound (egress) Google Cloud Pub/Sub message client.
 *
 * `usePubSub(outboundRoutePipeline, pubSub, topic, topicAttributeKey?)` converts an `OutboundContext`
 * route to publish via a caller-supplied `@google-cloud/pubsub` `PubSub` client: the routed message
 * becomes the Pub/Sub message data, and the routing topic + headers are written as message attributes
 * (the `"topic"` attribute the Benzene Pub/Sub ingress routes on). The egress counterpart of
 * `@benzene/google-cloud-functions-pubsub`.
 */
export * from './PubSubSendMessageContext';
export * from './PubSubClientMiddleware';
export * from './OutboundPubSubContextConverter';
export * from './Extensions';
