/** Port of Benzene.CloudService.CloudServiceDescriptorSource. */
import { Constructor, IServiceResolver } from '@benzenejs/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
} from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { CacheMessageHandlersFinder, RegistryMessageHandlersFinder } from '@benzenejs/core-message-handlers';
import { MeshDescriptorFactory, MeshServiceDescriptor, MeshServiceInfo } from '@benzenejs/mesh-wire';
import { CloudServiceProfileReport } from './CloudServiceProfileReport';

/**
 * The single source of this service's ServiceDescriptor (mesh.md §2) for the reserved-topic middleware and
 * the announcer. Built once: eagerly at wire-up when the handler types were given explicitly, otherwise
 * lazily from the container's registry on first use. Both paths stamp the profile self-assessment onto the
 * descriptor (mesh.md §2's `profile` field, excluded from the contract hash).
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
  ) {
    if (handlerTypes !== undefined) {
      const definitions = new CacheMessageHandlersFinder(
        new RegistryMessageHandlersFinder(...handlerTypes),
      ).findDefinitions();
      this.descriptor = this.build(new ListLookUp(definitions));
    }
  }

  /** The descriptor, if it has been built yet; the eager path always has one. */
  tryGet(): MeshServiceDescriptor | undefined {
    return this.descriptor;
  }

  /** The descriptor, building it from the invocation's registry on first use if needed. */
  get(resolver: IServiceResolver): MeshServiceDescriptor {
    return (this.descriptor ??= this.build(resolver.tryGetService(IMessageHandlerDefinitionLookUp)));
  }

  private build(lookUp: IMessageHandlerDefinitionLookUp | undefined): MeshServiceDescriptor {
    const descriptor = MeshDescriptorFactory.create(lookUp, this.info);
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
