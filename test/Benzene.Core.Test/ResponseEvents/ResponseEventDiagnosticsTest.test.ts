import { describe, expect, it } from 'vitest';
import {
  IServiceResolver,
  LoggerBase,
  LogLevel,
  ServiceIdentifier,
  VoidResult,
} from '@benzene/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
} from '@benzene/abstractions-message-handlers';
import { Topic } from '@benzene/core-messages';
import { MessageHandlerDefinition } from '@benzene/core-message-handlers';
import {
  CrudConventionResponseEventMapping,
  ExplicitResponseEventMapping,
  findUnmappedResponseHandlers,
  IResponseEventCatalog,
  IResponseEventMapping,
  logUnmappedResponseHandlers,
  PublishFailureMode,
  ResponseEventCatalog,
  ResponseEventMappings,
} from '@benzene/response-events';

/** Port of test/Benzene.Core.Test/ResponseEvents/ResponseEventDiagnosticsTest.cs. */

class OrderPayload {}
class OrderHandler {}

/** A minimal IServiceResolver backed by an identity map of (token/class -> instance). */
function makeResolver(entries: [unknown, unknown][]): IServiceResolver {
  const map = new Map(entries);
  return {
    getService: <T>(id: ServiceIdentifier<T>): T => {
      if (!map.has(id)) {
        throw new Error('not registered');
      }
      return map.get(id) as T;
    },
    tryGetService: <T>(id: ServiceIdentifier<T>): T | undefined => map.get(id) as T | undefined,
    getServices: <T>(id: ServiceIdentifier<T>): T[] => (map.has(id) ? [map.get(id) as T] : []),
    dispose: () => {},
  };
}

const def = (topic: string, responseType: ServiceIdentifier<unknown>) =>
  MessageHandlerDefinition.createInstance(topic, OrderPayload, responseType, OrderHandler);

function buildResolver(definitions: IMessageHandlerDefinition[], mappings?: ResponseEventMappings): IServiceResolver {
  const finder: IMessageHandlersFinder = { findDefinitions: () => definitions };
  const entries: [unknown, unknown][] = [[IMessageHandlersFinder, finder]];
  if (mappings !== undefined) {
    entries.push([IResponseEventCatalog, new ResponseEventCatalog([mappings], [])]);
  }
  return makeResolver(entries);
}

function mappingsOf(...list: IResponseEventMapping[]): ResponseEventMappings {
  return new ResponseEventMappings(list, PublishFailureMode.FailMessage);
}

class CapturingLogger extends LoggerBase {
  readonly entries: { level: LogLevel; message: string }[] = [];
  log(level: LogLevel, message: string): void {
    this.entries.push({ level, message });
  }
  beginScope() {
    return { dispose: () => {} };
  }
}

describe('response-event diagnostics', () => {
  it('a response handler with no mapping is reported', () => {
    const resolver = buildResolver([def('order:cancel', OrderPayload)]);

    const gaps = findUnmappedResponseHandlers(resolver);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.topic.id).toBe('order:cancel');
    expect(gaps[0]!.handlerType).toBe(OrderHandler);
    expect(gaps[0]!.responseType).toBe(OrderPayload);
  });

  it('a no-response handler is ignored', () => {
    const resolver = buildResolver([def('order:notify', VoidResult)]);

    expect(findUnmappedResponseHandlers(resolver)).toHaveLength(0);
  });

  it('an explicit mapping covering the topic is ignored', () => {
    const resolver = buildResolver(
      [def('order:create', OrderPayload)],
      mappingsOf(new ExplicitResponseEventMapping('order:create', 'order:created')),
    );

    expect(findUnmappedResponseHandlers(resolver)).toHaveLength(0);
  });

  it('the CRUD convention covers create but not cancel', () => {
    const resolver = buildResolver(
      [def('order:create', OrderPayload), def('order:cancel', OrderPayload)],
      mappingsOf(new CrudConventionResponseEventMapping()),
    );

    const gaps = findUnmappedResponseHandlers(resolver);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.topic.id).toBe('order:cancel');
  });

  it('with no catalog registered, reports all response handlers', () => {
    const resolver = buildResolver([def('order:create', OrderPayload)]);

    expect(findUnmappedResponseHandlers(resolver)).toHaveLength(1);
  });

  it('with no finder registered, returns empty', () => {
    expect(findUnmappedResponseHandlers(makeResolver([]))).toHaveLength(0);
  });

  it('orders by topic then handler', () => {
    const resolver = buildResolver([def('b:cancel', OrderPayload), def('a:cancel', OrderPayload)]);

    const gaps = findUnmappedResponseHandlers(resolver);

    expect(gaps.map((x) => x.topic.id)).toEqual(['a:cancel', 'b:cancel']);
  });

  it('logUnmappedResponseHandlers logs a warning per gap and returns them', () => {
    const resolver = buildResolver([def('order:cancel', OrderPayload)]);
    const logger = new CapturingLogger();

    const gaps = logUnmappedResponseHandlers(resolver, logger);

    expect(gaps).toHaveLength(1);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]!.level).toBe(LogLevel.Warning);
    expect(logger.entries[0]!.message).toContain('order:cancel');
  });

  it('CrudConvention covers create/update/delete only', () => {
    const mapping = new CrudConventionResponseEventMapping();

    expect(mapping.covers(new Topic('order:create'))).toBe(true);
    expect(mapping.covers(new Topic('order:update'))).toBe(true);
    expect(mapping.covers(new Topic('order:delete'))).toBe(true);
    expect(mapping.covers(new Topic('order:cancel'))).toBe(false);
  });

  it('ExplicitMapping covers matches its source topic case-insensitively', () => {
    const mapping: IResponseEventMapping = new ExplicitResponseEventMapping('order:create', 'order:created');

    expect(mapping.covers(new Topic('ORDER:create'))).toBe(true);
    expect(mapping.covers(new Topic('order:cancel'))).toBe(false);
  });
});
