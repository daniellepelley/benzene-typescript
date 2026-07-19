/** Port of Benzene.Extras.Broadcast.BroadcastEventChecker. */
import { IMessageDefinition } from '@benzene/abstractions-messages';
import { IBroadcastEventChecker } from './IBroadcastEventChecker';

/**
 * Default {@link IBroadcastEventChecker}: holds the registered event definitions and matches an
 * incoming (topic, payload) pair against them.
 * Port of Benzene.Extras.Broadcast.BroadcastEventChecker.
 *
 * **Erasure handling.** The C# `Check<T>` compares `typeof(T)` to each definition's `RequestType`.
 * `T` is erased in TypeScript, so the match uses the payload's runtime `constructor` against the
 * definition's `requestType` (a constructor/service identifier) — the same class-reference model the
 * rest of the port uses in place of `System.Type`.
 */
export class BroadcastEventChecker implements IBroadcastEventChecker {
  private readonly messageDefinitions: IMessageDefinition[];

  constructor(...messageDefinitions: IMessageDefinition[]) {
    this.messageDefinitions = messageDefinitions;
  }

  check<T>(topic: string, payload: T): boolean {
    const payloadType = payload == null ? undefined : (payload as object).constructor;
    return this.messageDefinitions.some(
      (definition) => definition.topic.id === topic && payloadType === definition.requestType,
    );
  }

  findDefinitions(): IMessageDefinition[] {
    return this.messageDefinitions;
  }
}
