import { describe, expect, it, vi } from 'vitest';
import {
  BenzeneStartUpCheckMode,
  IBenzeneServiceContainer,
  ILogger,
  ILoggerFactory,
  IServiceResolver,
  IStartUpCheck,
  VoidResult,
} from '@benzene/abstractions';
import { IMessageHandlerDefinition, IMessageHandlersFinder } from '@benzene/abstractions-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  addBenzene,
  addBenzeneStartUpChecks,
  BenzeneStartUpCheckException,
  DuplicateTopicStartUpCheck,
  EmptyHandlerRegistryStartUpCheck,
  runStartUpChecks,
} from '@benzene/core-message-handlers';

/**
 * Tests the ported `Benzene.Core.MessageHandlers.StartUpChecks`: boot-time wiring checks run once, off the
 * message path, by the runner every host's StartUpRunner calls. Two different handlers claiming one topic
 * fails start-up; the mode switch softens or silences it; an empty registry only warns.
 */
class CreateOrder {}
class HandlerA {}
class HandlerB {}

function handlerDef(topic: string, handlerType: unknown): IMessageHandlerDefinition {
  return {
    topic: { id: topic, version: '' },
    requestType: CreateOrder,
    responseType: VoidResult,
    handlerType,
  } as unknown as IMessageHandlerDefinition;
}

function finderReturning(defs: IMessageHandlerDefinition[]) {
  return { findDefinitions: () => defs };
}

/** A container wired with a message-handler finder and the given checks, ready to build a factory from. */
function containerWith(
  defs: IMessageHandlerDefinition[],
  checks: IStartUpCheck[],
  logger?: ILogger,
): IBenzeneServiceContainer {
  const container = new DefaultBenzeneServiceContainer();
  container.addSingletonInstance(IMessageHandlersFinder, finderReturning(defs));
  for (const check of checks) {
    container.addSingletonInstance(IStartUpCheck, check);
  }
  if (logger !== undefined) {
    const factory: ILoggerFactory = { createLogger: () => logger };
    container.addSingletonInstance(ILoggerFactory, factory);
  }
  return container;
}

function run(container: IBenzeneServiceContainer): void {
  runStartUpChecks(container.createServiceResolverFactory());
}

describe('start-up checks — the runner', () => {
  it('fails start-up when two different handlers claim the same topic', () => {
    const container = containerWith(
      [handlerDef('orders:create', HandlerA), handlerDef('orders:create', HandlerB)],
      [new DuplicateTopicStartUpCheck()],
    );
    let thrown: unknown;
    try {
      run(container);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BenzeneStartUpCheckException);
    expect((thrown as BenzeneStartUpCheckException).failedChecks).toEqual(['duplicate-topic']);
    expect((thrown as Error).message).toContain('orders:create');
    expect((thrown as Error).message).toContain('HandlerA');
    expect((thrown as Error).message).toContain('HandlerB');
  });

  it('passes a clean single-handler wiring', () => {
    const container = containerWith([handlerDef('orders:create', HandlerA)], [new DuplicateTopicStartUpCheck()]);
    expect(() => run(container)).not.toThrow();
  });

  it('treats the same handler registered twice for one topic as a duplicate registration, not a collision', () => {
    const container = containerWith(
      [handlerDef('orders:create', HandlerA), handlerDef('orders:create', HandlerA)],
      [new DuplicateTopicStartUpCheck()],
    );
    expect(() => run(container)).not.toThrow();
  });

  it('logs and continues in Advisory mode instead of throwing', () => {
    const logError = vi.fn();
    const logger = { logError } as unknown as ILogger;
    const container = containerWith(
      [handlerDef('orders:create', HandlerA), handlerDef('orders:create', HandlerB)],
      [new DuplicateTopicStartUpCheck()],
      logger,
    );
    addBenzeneStartUpChecks(container, BenzeneStartUpCheckMode.Advisory);

    expect(() => run(container)).not.toThrow();
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('runs nothing at all in Disabled mode', () => {
    const check = new DuplicateTopicStartUpCheck();
    const spy = vi.spyOn(check, 'check');
    const container = containerWith(
      [handlerDef('orders:create', HandlerA), handlerDef('orders:create', HandlerB)],
      [check],
    );
    addBenzeneStartUpChecks(container, BenzeneStartUpCheckMode.Disabled);

    expect(() => run(container)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports every failing check, not just the first', () => {
    const boom = (name: string): IStartUpCheck => ({
      name,
      check: () => {
        throw new Error(`${name} failed`);
      },
    });
    const container = containerWith([], [boom('check-one'), boom('check-two')]);
    let thrown: unknown;
    try {
      run(container);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as BenzeneStartUpCheckException).failedChecks).toEqual(['check-one', 'check-two']);
  });
});

describe('start-up checks — empty handler registry', () => {
  it('warns (does not throw) when no handlers were discovered', () => {
    const logError = vi.fn();
    const logger = { logError } as unknown as ILogger;
    const container = containerWith([], [new EmptyHandlerRegistryStartUpCheck()], logger);

    expect(() => run(container)).not.toThrow();
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('is silent when at least one handler exists', () => {
    const logError = vi.fn();
    const logger = { logError } as unknown as ILogger;
    const container = containerWith(
      [handlerDef('orders:create', HandlerA)],
      [new EmptyHandlerRegistryStartUpCheck()],
      logger,
    );

    run(container);
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('start-up checks — registration', () => {
  it('addBenzene registers the duplicate-topic and empty-handler-registry checks', () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    const resolver: IServiceResolver = container.createServiceResolverFactory().createScope();
    const names = resolver.getServices(IStartUpCheck).map((c) => c.name);
    expect(names).toContain('duplicate-topic');
    expect(names).toContain('empty-handler-registry');
  });
});
