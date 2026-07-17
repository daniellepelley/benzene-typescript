import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { VoidResult } from '@benzene/abstractions';
import { BenzeneException } from '@benzene/core';
import {
  CacheMessageHandlersFinder,
  CompositeMessageHandlersFinder,
  DependencyMessageHandlersFinder,
  MessageHandlerDefinition,
  MessageHandlersList,
  MessageHandlersRegistry,
  RegistryMessageHandlersFinder,
  importMessageHandlers,
  message,
} from '@benzene/core-message-handlers';
import { Defaults } from './Examples/Defaults';
import { ExampleMessageHandler, ExampleNoResponseMessageHandler } from './Examples/ExampleMessageHandler';
import { ExampleRequestPayload, ExampleResponsePayload } from './Examples/ExampleRequestPayload';

/** Port of Benzene.Test.Core.Core.MessageHandling.MessageHandlersFinderTest. */
describe('MessageHandlersFinderTest', () => {
  it('FindHandlers', () => {
    const finder = new RegistryMessageHandlersFinder();

    const handlers = finder.findDefinitions();

    const handlerDefinition = handlers.find((x) => x.topic.id === Defaults.topic)!;

    expect(handlerDefinition.handlerType).toBe(ExampleMessageHandler);
    expect(handlerDefinition.requestType).toBe(ExampleRequestPayload);
    expect(handlerDefinition.responseType).toBe(ExampleResponsePayload);

    const handlerDefinition2 = handlers.find((x) => x.topic.id === Defaults.topicNoResponse)!;

    expect(handlerDefinition2.handlerType).toBe(ExampleNoResponseMessageHandler);
    expect(handlerDefinition2.requestType).toBe(ExampleRequestPayload);
    expect(handlerDefinition2.responseType).toBe(VoidResult);
  });

  it('FindHandlers_Deduplicates', () => {
    const finder = new RegistryMessageHandlersFinder(ExampleMessageHandler, ExampleMessageHandler);

    const handlerDefinitions = finder.findDefinitions();
    expect(handlerDefinitions).toHaveLength(1);

    const handlerDefinition = handlerDefinitions.find((x) => x.topic.id === Defaults.topic)!;

    expect(handlerDefinition.handlerType).toBe(ExampleMessageHandler);
    expect(handlerDefinition.requestType).toBe(ExampleRequestPayload);
    expect(handlerDefinition.responseType).toBe(ExampleResponsePayload);
  });

  it('FindHandlers_SkipsClassesWithoutMessageMetadata', () => {
    class NotAHandler {}

    const finder = new RegistryMessageHandlersFinder(ExampleMessageHandler, NotAHandler);

    expect(finder.findDefinitions()).toHaveLength(1);
  });

  it('FindHandlers_DuplicateTopic_Throws', () => {
    const registry = new MessageHandlersRegistry();

    message('duplicate-topic', { registry })(class FirstHandler {});
    message('duplicate-topic', { registry })(class SecondHandler {});

    const finder = new RegistryMessageHandlersFinder(registry);

    expect(() => finder.findDefinitions()).toThrow(BenzeneException);
    expect(() => finder.findDefinitions()).toThrow(
      "Topic 'duplicate-topic' has been assigned to more than one message handler, this is not permitted",
    );
  });

  it('FindHandlers_SameTopicDifferentVersions_IsPermitted', () => {
    const registry = new MessageHandlersRegistry();

    const v1 = class V1Handler {};
    const v2 = class V2Handler {};
    message('versioned-topic', { version: 'v1', registry })(v1);
    message('versioned-topic', { version: 'v2', registry })(v2);

    const finder = new RegistryMessageHandlersFinder(registry);

    expect(finder.findDefinitions()).toHaveLength(2);
  });

  it('ImportMessageHandlers_DiscoversHandlerModulesFromDirectory', async () => {
    const directory = fileURLToPath(new URL('./AutoDiscovered', import.meta.url));

    await importMessageHandlers(directory);

    const handlers = new RegistryMessageHandlersFinder().findDefinitions();
    const topics = handlers.map((x) => x.topic.id);

    expect(topics).toContain('auto-create-order');
    expect(topics).toContain('auto-cancel-order');
  });

  it('CompositeFinder_CombinesInnerFinders', () => {
    const list = new MessageHandlersList();
    list.add(MessageHandlerDefinition.createInstance('from-list', VoidResult, VoidResult));

    const dependencyFinder = new DependencyMessageHandlersFinder([
      MessageHandlerDefinition.createInstance('from-dependency', VoidResult, VoidResult),
    ]);

    const composite = new CompositeMessageHandlersFinder(list, dependencyFinder);

    expect(composite.findDefinitions().map((x) => x.topic.id)).toEqual([
      'from-list',
      'from-dependency',
    ]);
  });

  it('CacheFinder_OnlyCallsInnerOnce', () => {
    let calls = 0;
    const inner = {
      findDefinitions: () => {
        calls += 1;
        return [MessageHandlerDefinition.createInstance('cached', VoidResult, VoidResult)];
      },
    };

    const cache = new CacheMessageHandlersFinder(inner);
    cache.findDefinitions();
    cache.findDefinitions();

    expect(calls).toBe(1);
  });
});
