import { ILoggerFactory, IServiceResolver, IStartUpCheck } from '@benzenejs/abstractions';
import { IMessageHandlerDefinition, IMessageHandlersFinder } from '@benzenejs/abstractions-message-handlers';
import { BenzeneException } from '@benzenejs/core';

const LOGGER_CATEGORY = 'Benzene.StartUpChecks';

/**
 * Checks each topic's **default handler** — the one a message carrying no version goes to
 * (core-concepts §2).
 *
 * - **Throws** when more than one handler of a topic is declared default (`isDefault: true`): only one
 *   can receive unversioned messages, and which one would depend on registration order.
 * - **Warns** (logs; start-up continues) for a topic whose handlers are all versioned and none is declared
 *   default. That is valid, but every message to it without a `benzene-version` will be `not-found` —
 *   which the spec says SHOULD be reported at start-up.
 *
 * TypeScript-only check (no .NET file of this name at the time of porting); it follows the shape of
 * `DuplicateTopicStartUpCheck` (the throw) and `EmptyHandlerRegistryStartUpCheck` (the warning).
 */
export class DefaultHandlerStartUpCheck implements IStartUpCheck {
  readonly name = 'default-handler';

  check(resolver: IServiceResolver): void {
    const finder = resolver.tryGetService(IMessageHandlersFinder);
    if (finder === undefined) {
      return;
    }

    const byTopic = new Map<string, IMessageHandlerDefinition[]>();
    for (const definition of finder.findDefinitions()) {
      const group = byTopic.get(definition.topic.id) ?? [];
      group.push(definition);
      byTopic.set(definition.topic.id, group);
    }

    const conflicting: string[] = [];
    const withoutDefault: string[] = [];
    for (const [topic, handlers] of byTopic) {
      const declared = distinctVersions(handlers.filter((h) => h.isDefault === true));
      if (declared.length > 1) {
        conflicting.push(`'${topic}' declares versions ${declared.map((v) => `'${v}'`).join(', ')} default`);
      }
      if (declared.length === 0 && handlers.every((h) => h.topic.version !== '')) {
        withoutDefault.push(`'${topic}' (versions ${distinctVersions(handlers).map((v) => `'${v}'`).join(', ')})`);
      }
    }

    if (withoutDefault.length > 0) {
      resolver
        .tryGetService(ILoggerFactory)
        ?.createLogger(LOGGER_CATEGORY)
        .logWarning(
          `These topics have only versioned handlers and no default handler: ${withoutDefault.join('; ')}. ` +
            `A message to them without a 'benzene-version' header will be answered not-found. If producers ` +
            `may send no version, declare one handler the default: @message(topic, { version, isDefault: true }).`,
        );
    }

    if (conflicting.length > 0) {
      throw new BenzeneException(
        `More than one handler is declared the default for the same topic: ${conflicting.join('; ')}. ` +
          'A message without a version can go to only one of them. Keep isDefault: true on exactly one ' +
          'handler per topic.',
      );
    }
  }
}

function distinctVersions(handlers: readonly IMessageHandlerDefinition[]): string[] {
  return [...new Set(handlers.map((h) => h.topic.version))].sort();
}
