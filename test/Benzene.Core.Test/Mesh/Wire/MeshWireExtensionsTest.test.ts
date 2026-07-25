/**
 * Port of the UseMeshDescriptor scenarios in Benzene.Test.Mesh.Wire.ExtensionsTest: drive a real
 * BenzeneMessage pipeline and assert the reserved `mesh` topic (plus aliases) short-circuits with the
 * descriptor while every other topic falls through. The C# file's UseMeshTrace scenarios cover the
 * trace feed, which this port doesn't yet include (see README).
 */
import { describe, expect, it } from 'vitest';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResultStatus } from '@benzene/results';
import {
  addBenzene,
  addBenzeneMessage,
  addContextItems,
  BenzeneMessageApplication,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { MeshServiceDescriptor, MeshTopics, useMeshDescriptor } from '@benzene/mesh-wire';

function newPipeline(): {
  builder: MiddlewarePipelineBuilder<BenzeneMessageContext>;
  container: DefaultBenzeneServiceContainer;
} {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);
  // Registers the default IMessageGetter/IMessageHandlerResultSetter mappers (the C# test's AddContextItems);
  // useMeshDescriptor resolves both. Normally useMessageHandlers pulls these in, but this pipeline has none.
  addContextItems(container);
  return { builder: new MiddlewarePipelineBuilder<BenzeneMessageContext>(container), container };
}

function descriptorFor(service: string): MeshServiceDescriptor {
  const descriptor = new MeshServiceDescriptor();
  descriptor.service = service;
  return descriptor;
}

async function send(
  builder: MiddlewarePipelineBuilder<BenzeneMessageContext>,
  container: DefaultBenzeneServiceContainer,
  topic: string,
) {
  const app = new BenzeneMessageApplication(builder.build());
  const request = new BenzeneMessageRequest();
  request.topic = topic;
  request.headers = {};
  request.body = '';
  return app.handleAsync(request, container.createServiceResolverFactory());
}

describe('MeshWireExtensionsTest', () => {
  it('UseMeshDescriptor_MatchingTopic_ShortCircuitsWithTheDescriptor', async () => {
    const { builder, container } = newPipeline();
    useMeshDescriptor(builder, descriptorFor('orders-service'));

    const response = await send(builder, container, MeshTopics.descriptor);

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(response.body).toContain('orders-service');
  });

  it('UseMeshDescriptor_AliasTopic_ShortCircuitsWithTheDescriptor', async () => {
    const { builder, container } = newPipeline();
    useMeshDescriptor(builder, descriptorFor('orders-service'), 'orders.mesh');

    const response = await send(builder, container, 'orders.mesh');

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(response.body).toContain('orders-service');
  });

  it('UseMeshDescriptor_NonMatchingTopic_FallsThroughToNextMiddleware', async () => {
    const { builder, container } = newPipeline();
    let nextRan = false;
    useMeshDescriptor(builder, descriptorFor('orders-service'));
    builder.useFn('Terminal', (_context, next) => {
      nextRan = true;
      return next();
    });

    await send(builder, container, 'some-other-topic');

    expect(nextRan).toBe(true);
  });
});
