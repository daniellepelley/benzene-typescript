import { Constructor } from '@benzene/abstractions';

/**
 * TypeScript-only file with no direct C# counterpart.
 *
 * In .NET, `ReflectionMessageHandlersFinder` discovers handlers by scanning
 * loaded assemblies. JavaScript has no assembly scanning, so decorated handler
 * classes register themselves here when their module is imported, and
 * RegistryMessageHandlersFinder reads from this registry — the same "declare
 * the handler and it is found" experience. Use `importMessageHandlers` to load
 * a whole directory of handler modules automatically.
 *
 * The global registry parallels the process-wide nature of .NET assembly
 * scanning; isolated instances can be created for tests.
 */
export class MessageHandlersRegistry {
  static readonly global: MessageHandlersRegistry = new MessageHandlersRegistry();

  private readonly handlerTypes = new Set<Constructor<unknown>>();

  register(handlerType: Constructor<unknown>): void {
    this.handlerTypes.add(handlerType);
  }

  getAll(): Constructor<unknown>[] {
    return [...this.handlerTypes];
  }

  clear(): void {
    this.handlerTypes.clear();
  }
}
