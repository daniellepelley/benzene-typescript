/** The cloud service's single source of its Contract Document (replaces the .NET `CloudServiceDescriptorSource`). */
import { IBenzeneResultOf, IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { RawStringMessage } from '@benzenejs/core-messages';
import { deriveContractDocument, SpecMessageHandler, SpecRequest } from '@benzenejs/schema-openapi';

/**
 * One document, served and registered (mesh.md §1-§2): the Contract Document the host's `benzene:spec` serves
 * is the document the announcer registers with a collector, and the one the wire-envelope pipeline answers
 * `benzene:spec` with (Cloud Service Profile R6: the self-description on every transport).
 *
 * It is derived from the HOST (outer) container - where the handlers, the schema sources, the outbound
 * declarations, the application info and the deployment info are registered - through that container's
 * `SpecCache`, so all three readers share one derivation. The host container is attached at boot by the
 * cloud service's start-up hook (every host runs start-up checks), or by the first invocation when a host
 * runs none.
 *
 * Divergence from C#: the .NET source builds a ServiceDescriptor from the registry; spec 3b deleted the
 * descriptor, and in this port the envelope pipeline has its own DI container (see `useBenzeneMessage`), so
 * the source holds the host's resolver factory rather than a built object.
 */
export class CloudServiceContractDocumentSource {
  private factory?: IServiceResolverFactory;
  private document?: string;

  /** Attaches the host container (first caller wins; later calls are no-ops). */
  attach(resolver: IServiceResolver): void {
    this.factory ??= resolver.getService(IServiceResolverFactory);
  }

  get isAttached(): boolean {
    return this.factory !== undefined;
  }

  /**
   * The Contract Document as JSON, deriving it once from the host container, or `undefined` while no host
   * container is attached. Throws what the derivation throws (a naming collision, an event/send clash) - the
   * same error the `contract-document` start-up check reports.
   */
  tryGet(): string | undefined {
    if (this.document === undefined && this.factory !== undefined) {
      this.document = this.withHostScope(deriveContractDocument);
    }
    return this.document;
  }

  /** Runs `action` on a fresh scope of the host container. */
  withHostScope<T>(action: (resolver: IServiceResolver) => T): T {
    const scope = this.createHostScope();
    try {
      return action(scope);
    } finally {
      scope.dispose();
    }
  }

  /** Awaits `action` on a fresh scope of the host container, disposing it once the action settles. */
  async withHostScopeAsync<T>(action: (resolver: IServiceResolver) => Promise<T>): Promise<T> {
    const scope = this.createHostScope();
    try {
      return await action(scope);
    } finally {
      scope.dispose();
    }
  }

  private createHostScope(): IServiceResolver {
    if (this.factory === undefined) {
      throw new Error('The cloud service has not attached its host container yet; no contract document to serve.');
    }
    return this.factory.createScope();
  }
}

/**
 * The wire-envelope pipeline's `benzene:spec` handler: the host's `SpecMessageHandler`, run on a scope of the host
 * container, so `POST /benzene/invoke` with `benzene:spec` answers exactly what `GET /benzene/spec` does - every
 * `{ type, format }` included - from the same cached derivation.
 */
export class CloudServiceSpecMessageHandler implements IMessageHandler<SpecRequest, RawStringMessage> {
  constructor(private readonly source: CloudServiceContractDocumentSource) {}

  handleAsync(request: SpecRequest): Promise<IBenzeneResultOf<RawStringMessage>> {
    return this.source.withHostScopeAsync((resolver) => new SpecMessageHandler(resolver).handleAsync(request));
  }
}
