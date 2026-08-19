/**
 * An `IMeshSchemaProvider` that derives a topic's request/response payload schemas from the JSON-Schema
 * sources the validation adapters register (`@benzenejs/zod`/`joi`/`yup` each register an
 * `ITypeJsonSchemaSource`). This is the runtime replacement for the C# `MeshSchemaGenerator` reflecting over
 * the CLR request/response type: TypeScript erases types, so the schema is *provided* by whatever validated
 * the type at runtime.
 *
 * `getSchemas(topic)` first looks for an inbound handler definition (`IMessageHandlerDefinitionLookUp`,
 * what the topic is served by, mesh.md §2's `topics`); when none matches, it falls back to an outbound sender
 * definition (`IMessageSendersFinder`, when supplied - mesh.md §2.3's `produces`, "same schema-derivation
 * rules applied to the sender's declared request/response types"). Either way it takes the definition's
 * request/response type constructors and asks each registered source in turn for a JSON Schema (first hit
 * wins). A topic matching neither — or types with no registered schema — yields `{}` (unconstrained), the
 * spec's documented no-schema case, so a partially-validated service still self-describes its full
 * provided/consumed topic lists.
 */
import { Constructor, IServiceResolver, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { IMessageSendersFinder, ITopic } from '@benzenejs/abstractions-messages';
import { IMessageHandlerDefinitionLookUp } from '@benzenejs/abstractions-message-handlers';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { IMeshSchemaProvider, MeshTopicSchemas } from './MeshSchemaProvider';

export class ValidationMeshSchemaProvider implements IMeshSchemaProvider {
  constructor(
    private readonly lookUp: IMessageHandlerDefinitionLookUp,
    private readonly sources: readonly ITypeJsonSchemaSource[],
    private readonly sendersFinder?: IMessageSendersFinder,
  ) {}

  getSchemas(topic: ITopic): MeshTopicSchemas {
    const handler = this.lookUp.findHandler(topic);
    if (handler !== undefined) {
      return this.schemasFor(handler.requestType, handler.responseType);
    }

    const sender = this.sendersFinder
      ?.findDefinitions()
      .find((x) => x.topic.id === topic.id && x.topic.version === topic.version);
    if (sender !== undefined) {
      return this.schemasFor(sender.requestType, sender.responseType);
    }

    return {};
  }

  private schemasFor(
    requestType: ServiceIdentifier<unknown>,
    responseType: ServiceIdentifier<unknown>,
  ): MeshTopicSchemas {
    const schemas: MeshTopicSchemas = {};
    const request = this.schemaFor(requestType);
    if (request !== undefined) {
      schemas.request = request;
    }
    const response = this.schemaFor(responseType);
    if (response !== undefined) {
      schemas.response = response;
    }
    return schemas;
  }

  private schemaFor(type: ServiceIdentifier<unknown>): Record<string, unknown> | undefined {
    // Only a class constructor can have a registered schema; the `VoidResult` sentinel means "no payload".
    if (typeof type !== 'function' || type === VoidResult) {
      return undefined;
    }
    for (const source of this.sources) {
      const schema = source.getJsonSchema(type as Constructor<unknown>);
      if (schema !== undefined) {
        return schema;
      }
    }
    return undefined;
  }
}

/**
 * Builds a `ValidationMeshSchemaProvider` from the container: the handler lookup, every registered
 * `ITypeJsonSchemaSource` (whatever validation adapters — or a hand-registered source — are wired), and,
 * when registered, the outbound `IMessageSendersFinder` (mesh.md §2.3) so consumed-topic schemas resolve
 * too. Pass the result to `MeshDescriptorFactory.create` so the descriptor carries payload schemas.
 */
export function validationMeshSchemaProvider(resolver: IServiceResolver): ValidationMeshSchemaProvider {
  return new ValidationMeshSchemaProvider(
    resolver.getService(IMessageHandlerDefinitionLookUp),
    resolver.getServices(ITypeJsonSchemaSource),
    resolver.tryGetService(IMessageSendersFinder),
  );
}
