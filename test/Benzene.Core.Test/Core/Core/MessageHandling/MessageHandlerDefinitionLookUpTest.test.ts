import { describe, expect, it } from 'vitest';
import { VoidResult } from '@benzene/abstractions';
import { Topic } from '@benzene/core-messages';
import {
  MessageHandlerDefinition,
  MessageHandlerDefinitionIndex,
  MessageHandlerDefinitionLookUp,
  MessageHandlersList,
  VersionSelector,
} from '@benzene/core-message-handlers';

/** Port of the version-selection and lookup scenarios from Benzene.Core.Test. */
class OrderV1Handler {}
class OrderV2Handler {}

function createLookUp(list?: MessageHandlersList) {
  const definitions = new MessageHandlersList();
  definitions.add(
    MessageHandlerDefinition.createInstance('create-order', 'v1', VoidResult, VoidResult, OrderV1Handler),
  );
  definitions.add(
    MessageHandlerDefinition.createInstance('create-order', 'v2', VoidResult, VoidResult, OrderV2Handler),
  );

  const finders = list ? [definitions, list] : [definitions];
  const index = new MessageHandlerDefinitionIndex(finders, list);
  return new MessageHandlerDefinitionLookUp(index, new VersionSelector());
}

describe('MessageHandlerDefinitionLookUpTest', () => {
  it('FindHandler_ExactVersionMatch', () => {
    const lookUp = createLookUp();

    const definition = lookUp.findHandler(new Topic('create-order', 'v1'));

    expect(definition?.handlerType).toBe(OrderV1Handler);
  });

  it('FindHandler_UnknownVersion_SelectsHighestAvailable', () => {
    const lookUp = createLookUp();

    const definition = lookUp.findHandler(new Topic('create-order', 'v9'));

    expect(definition?.handlerType).toBe(OrderV2Handler);
  });

  it('FindHandler_UnknownTopic_ReturnsUndefined', () => {
    const lookUp = createLookUp();

    expect(lookUp.findHandler(new Topic('does-not-exist'))).toBeUndefined();
  });

  it('Index_RebuildsWhenMessageHandlersListGrows', () => {
    const list = new MessageHandlersList();
    const lookUp = createLookUp(list);

    expect(lookUp.findHandler(new Topic('late-arrival'))).toBeUndefined();

    class LateHandler {}
    list.add(
      MessageHandlerDefinition.createInstance('late-arrival', '', VoidResult, VoidResult, LateHandler),
    );

    expect(lookUp.findHandler(new Topic('late-arrival'))?.handlerType).toBe(LateHandler);
  });

  it('GetAllHandlers_ReturnsEverything', () => {
    const lookUp = createLookUp();

    expect(lookUp.getAllHandlers()).toHaveLength(2);
  });

  it('VersionSelector_PrefersExactMatch', () => {
    const selector = new VersionSelector();

    expect(selector.select('v1', ['v1', 'v2'])).toBe('v1');
    expect(selector.select('v9', ['v1', 'v2'])).toBe('v2');
    expect(selector.select('', ['v1', 'v2'])).toBe('v2');
  });
});
