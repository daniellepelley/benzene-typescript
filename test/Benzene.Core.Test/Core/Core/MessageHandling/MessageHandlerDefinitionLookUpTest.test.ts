import { describe, expect, it } from 'vitest';
import { ILogger, ILoggerFactory, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandlersFinder, IPayloadCastLookUp } from '@benzenejs/abstractions-message-handlers';
import { Topic } from '@benzenejs/core-messages';
import {
  DefaultHandlerStartUpCheck,
  HighestAvailableVersionSelector,
  MessageHandlerDefinition,
  MessageHandlerDefinitionIndex,
  MessageHandlerDefinitionLookUp,
  MessageHandlersList,
  VersionSelector,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';

/**
 * Port of the version-selection and lookup scenarios from Benzene.Core.Test, rewritten for the spec's
 * selection rule (core-concepts §2, spec-0.2.0): exact; else cast-reachable (the declared default wins a
 * tie); else not-found. No "highest available" by default; a message with no version goes to the default
 * handler.
 */
class OrderV1Handler {}
class OrderV2Handler {}
class OrderV1Request {}
class OrderV2Request {}

function createLookUp(options: { list?: MessageHandlersList; v1Default?: boolean; casts?: IPayloadCastLookUp } = {}) {
  const definitions = new MessageHandlersList();
  const v1 = MessageHandlerDefinition.createInstance('create-order', 'v1', OrderV1Request, VoidResult, OrderV1Handler);
  definitions.add(options.v1Default ? v1.asDefault() : v1);
  definitions.add(
    MessageHandlerDefinition.createInstance('create-order', 'v2', OrderV2Request, VoidResult, OrderV2Handler),
  );

  const finders = options.list ? [definitions, options.list] : [definitions];
  const index = new MessageHandlerDefinitionIndex(finders, options.list);
  return new MessageHandlerDefinitionLookUp(index, new VersionSelector(), options.casts);
}

/** A cast lookup over explicit (fromVersion -> request type) pairs. */
function casts(...pairs: [string, ServiceIdentifier<unknown>][]): IPayloadCastLookUp {
  return {
    canCast: (_topic, fromVersion, toType) => pairs.some(([from, to]) => from === fromVersion && to === toType),
  };
}

describe('MessageHandlerDefinitionLookUpTest', () => {
  it('FindHandler_ExactVersionMatch', () => {
    const lookUp = createLookUp();

    const definition = lookUp.findHandler(new Topic('create-order', 'v1'));

    expect(definition?.handlerType).toBe(OrderV1Handler);
  });

  it('FindHandler_UnknownVersion_IsNotFound_NotTheHighest', () => {
    const lookUp = createLookUp({ v1Default: true });

    expect(lookUp.findHandler(new Topic('create-order', 'v9'))).toBeUndefined();
  });

  it('FindHandler_NoVersion_GoesToTheDeclaredDefault', () => {
    const lookUp = createLookUp({ v1Default: true });

    expect(lookUp.findHandler(new Topic('create-order'))?.handlerType).toBe(OrderV1Handler);
  });

  it('FindHandler_NoVersion_WithNoDefault_IsNotFound', () => {
    const lookUp = createLookUp();

    expect(lookUp.findHandler(new Topic('create-order'))).toBeUndefined();
  });

  it('FindHandler_NoVersion_PrefersTheUnversionedHandler', () => {
    const list = new MessageHandlersList();
    class UnversionedHandler {}
    list.add(MessageHandlerDefinition.createInstance('create-order', '', VoidResult, VoidResult, UnversionedHandler));
    const lookUp = createLookUp({ list, v1Default: true });

    expect(lookUp.findHandler(new Topic('create-order'))?.handlerType).toBe(UnversionedHandler);
  });

  it('FindHandler_VersionSentToAnUnversionedOnlyTopic_IsNotFound', () => {
    const list = new MessageHandlersList();
    class GreetHandler {}
    list.add(MessageHandlerDefinition.createInstance('greet', '', VoidResult, VoidResult, GreetHandler));
    const lookUp = createLookUp({ list });

    expect(lookUp.findHandler(new Topic('greet', 'v2'))).toBeUndefined();
    expect(lookUp.findHandler(new Topic('greet'))?.handlerType).toBe(GreetHandler);
  });

  it('FindHandler_CastReachable_SelectsTheCastTarget', () => {
    const lookUp = createLookUp({ casts: casts(['v0', OrderV2Request]) });

    expect(lookUp.findHandler(new Topic('create-order', 'v0'))?.handlerType).toBe(OrderV2Handler);
  });

  it('FindHandler_CastToAnUnversionedHandler_IsATargetLikeAnyOther', () => {
    const list = new MessageHandlersList();
    class CanonicalRequest {}
    class CanonicalHandler {}
    list.add(MessageHandlerDefinition.createInstance('adjust', '', CanonicalRequest, VoidResult, CanonicalHandler));
    const lookUp = createLookUp({ list, casts: casts(['v1', CanonicalRequest]) });

    expect(lookUp.findHandler(new Topic('adjust', 'v1'))?.handlerType).toBe(CanonicalHandler);
    expect(lookUp.findHandler(new Topic('adjust', 'v7'))).toBeUndefined();
  });

  it('FindHandler_SeveralCastTargets_TheDeclaredDefaultWins', () => {
    const lookUp = createLookUp({ v1Default: true, casts: casts(['v0', OrderV1Request], ['v0', OrderV2Request]) });

    expect(lookUp.findHandler(new Topic('create-order', 'v0'))?.handlerType).toBe(OrderV1Handler);
  });

  it('FindHandler_SeveralCastTargets_NoDefaultAmongThem_TheHighestVersionWins', () => {
    // Deterministic and documented (VersionSelector): ordinally highest cast target.
    const lookUp = createLookUp({ casts: casts(['v0', OrderV1Request], ['v0', OrderV2Request]) });

    expect(lookUp.findHandler(new Topic('create-order', 'v0'))?.handlerType).toBe(OrderV2Handler);
  });

  it('FindHandler_UnknownTopic_ReturnsUndefined', () => {
    const lookUp = createLookUp();

    expect(lookUp.findHandler(new Topic('does-not-exist'))).toBeUndefined();
  });

  it('Index_RebuildsWhenMessageHandlersListGrows', () => {
    const list = new MessageHandlersList();
    const lookUp = createLookUp({ list });

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

  it('VersionSelector_FollowsTheSelectionRule', () => {
    const selector = new VersionSelector();

    expect(selector.select('v1', ['v1', 'v2'])).toBe('v1');
    expect(selector.select('v9', ['v1', 'v2'])).toBeUndefined();
    expect(selector.select('', ['v1', 'v2'])).toBeUndefined();
    expect(selector.select('', ['v1', 'v2'], { defaultVersion: 'v1' })).toBe('v1');
    expect(selector.select('v9', ['v1', 'v2'], { castableVersions: ['v1'] })).toBe('v1');
  });

  it('HighestAvailableVersionSelector_IsTheExplicitOptIn', () => {
    const selector = new HighestAvailableVersionSelector();

    expect(selector.select('v1', ['v1', 'v2'])).toBe('v1');
    expect(selector.select('v9', ['v1', 'v2'])).toBe('v2');
    expect(selector.select('', ['v1', 'v2'])).toBe('v2');
  });
});

describe('DefaultHandlerStartUpCheck', () => {
  class RecordingLogger {
    readonly warnings: string[] = [];
  }

  function resolverWith(definitions: MessageHandlerDefinition[], recorder: RecordingLogger) {
    const container = new DefaultBenzeneServiceContainer();
    const list = new MessageHandlersList();
    for (const definition of definitions) {
      list.add(definition);
    }
    container.addSingletonInstance(IMessageHandlersFinder, list);
    container.addSingletonInstance(ILoggerFactory, {
      createLogger: () =>
        ({
          logWarning: (message: string) => recorder.warnings.push(message),
        }) as unknown as ILogger,
    } as unknown as ILoggerFactory);
    return container.createServiceResolverFactory().createScope();
  }

  it('warns for a topic whose handlers are all versioned and none is declared default', () => {
    const recorder = new RecordingLogger();
    const resolver = resolverWith(
      [MessageHandlerDefinition.createInstance('create-order', 'v1', VoidResult, VoidResult, OrderV1Handler)],
      recorder,
    );

    new DefaultHandlerStartUpCheck().check(resolver);

    expect(recorder.warnings).toHaveLength(1);
    expect(recorder.warnings[0]).toContain("'create-order'");
  });

  it('is silent when the topic declares a default', () => {
    const recorder = new RecordingLogger();
    const resolver = resolverWith(
      [MessageHandlerDefinition.createInstance('create-order', 'v1', VoidResult, VoidResult, OrderV1Handler).asDefault()],
      recorder,
    );

    new DefaultHandlerStartUpCheck().check(resolver);

    expect(recorder.warnings).toHaveLength(0);
  });

  it('throws when two handlers of one topic are declared default', () => {
    const resolver = resolverWith(
      [
        MessageHandlerDefinition.createInstance('create-order', 'v1', VoidResult, VoidResult, OrderV1Handler).asDefault(),
        MessageHandlerDefinition.createInstance('create-order', 'v2', VoidResult, VoidResult, OrderV2Handler).asDefault(),
      ],
      new RecordingLogger(),
    );

    expect(() => new DefaultHandlerStartUpCheck().check(resolver)).toThrow(/declared the default/);
  });
});
