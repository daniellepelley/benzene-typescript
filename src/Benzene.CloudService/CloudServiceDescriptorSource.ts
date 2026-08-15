/** Port of Benzene.CloudService.CloudServiceDescriptorSource. */
import { Constructor, IServiceResolver } from '@benzenejs/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageSenderDefinition, IMessageSendersFinder, ITopic } from '@benzenejs/abstractions-messages';
import { CacheMessageHandlersFinder, RegistryMessageHandlersFinder } from '@benzenejs/core-message-handlers';
import { MeshDescriptorFactory, MeshServiceDescriptor, MeshServiceInfo } from '@benzenejs/mesh-wire';
import { CloudServiceProfileReport } from './CloudServiceProfileReport';

/**
 * The single source of this service's ServiceDescriptor (mesh.md §2) for the reserved-topic middleware and
 * the announcer. Built once: eagerly at wire-up when the handler types were given explicitly, otherwise
 * lazily from the container's registry on first use. Both paths stamp the profile self-assessment onto the
 * descriptor (mesh.md §2's `profile` field, excluded from the contract hash).
 *
 * `consumesDefinitions` (mesh.md §2.3, `ICloudServiceBuilder.withConsumes`) is the outbound-registration
 * counterpart of `handlerTypes`: when the builder declared any, they populate `consumes` eagerly the same
 * way `handlerTypes` populates `topics`; when it declared none, the lazy path still checks the container for
 * an `IMessageSendersFinder` a host may have registered independently, exactly mirroring how the lazy
 * `topics` path checks for `IMessageHandlerDefinitionLookUp`. Neither path guesses at outbound registration
 * from handler bodies (mesh.md §2.3 forbids it) - an app with no `withConsumes` calls and no registered
 * finder degrades `consumes` (`degraded: ["outbound-registry"]`), same as an app with no handlers degrades
 * `topics`.
 *
 * Divergence from C#: the eager reflection finder (`ReflectionMessageHandlersFinder`) maps to the port's
 * `RegistryMessageHandlersFinder` (decorator metadata, since TypeScript erases types). The C# double-checked
 * locking / `volatile` is dropped: JavaScript is single-threaded, so a plain memoized field is correct.
 */
export class CloudServiceDescriptorSource {
  private descriptor?: MeshServiceDescriptor;

  constructor(
    private readonly info: MeshServiceInfo,
    private readonly report: CloudServiceProfileReport,
    handlerTypes?: Constructor<unknown>[],
    private readonly consumesDefinitions?: IMessageSenderDefinition[],
  ) {
    if (handlerTypes !== undefined) {
      const definitions = new CacheMessageHandlersFinder(
        new RegistryMessageHandlersFinder(...handlerTypes),
      ).findDefinitions();
      this.descriptor = this.build(new ListLookUp(definitions), this.eagerSendersFinder());
    }
  }

  /** The descriptor, if it has been built yet; the eager path always has one. */
  tryGet(): MeshServiceDescriptor | undefined {
    return this.descriptor;
  }

  /** The descriptor, building it from the invocation's registry on first use if needed. */
  get(resolver: IServiceResolver): MeshServiceDescriptor {
    return (this.descriptor ??= this.build(
      resolver.tryGetService(IMessageHandlerDefinitionLookUp),
      this.eagerSendersFinder() ?? resolver.tryGetService(IMessageSendersFinder),
    ));
  }

  /** `withConsumes`-declared definitions, wrapped as a finder; `undefined` when the builder declared none. */
  private eagerSendersFinder(): IMessageSendersFinder | undefined {
    return this.consumesDefinitions === undefined || this.consumesDefinitions.length === 0
      ? undefined
      : new ListSendersFinder(this.consumesDefinitions);
  }

  private build(
    lookUp: IMessageHandlerDefinitionLookUp | undefined,
    sendersFinder: IMessageSendersFinder | undefined,
  ): MeshServiceDescriptor {
    const descriptor = MeshDescriptorFactory.create(lookUp, this.info, undefined, sendersFinder);
    descriptor.profile = this.report.toMeshProfile();
    return descriptor;
  }
}

/** A fixed-list `IMessageHandlerDefinitionLookUp` over eagerly-derived definitions (C# private `ListLookUp`). */
class ListLookUp implements IMessageHandlerDefinitionLookUp {
  constructor(private readonly definitions: IMessageHandlerDefinition[]) {}

  findHandler(topic: ITopic): IMessageHandlerDefinition | undefined {
    return this.definitions.find((x) => x.topic.id === topic.id && x.topic.version === topic.version);
  }

  getAllHandlers(): IMessageHandlerDefinition[] {
    return this.definitions;
  }
}

/** A fixed-list `IMessageSendersFinder` over the builder's `withConsumes`-declared definitions. */
class ListSendersFinder implements IMessageSendersFinder {
  constructor(private readonly definitions: IMessageSenderDefinition[]) {}

  findDefinitions(): IMessageSenderDefinition[] {
    return this.definitions;
  }
}
