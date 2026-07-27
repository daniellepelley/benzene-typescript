/**
 * An `IMeshSchemaProvider` that derives a topic's request/response payload schemas from the JSON-Schema
 * sources the validation adapters register (`@benzene/zod`/`joi`/`yup` each register an
 * `ITypeJsonSchemaSource`). This is the runtime replacement for the C# `MeshSchemaGenerator` reflecting over
 * the CLR request/response type: TypeScript erases types, so the schema is *provided* by whatever validated
 * the type at runtime.
 *
 * `getSchemas(topic)` finds the handler definition for the topic in the `IMessageHandlerDefinitionLookUp`,
 * takes its request/response type constructors, and asks each registered source in turn for a JSON Schema
 * (first hit wins). A topic with no matching handler — or types with no registered schema — yields `{}`
 * (unconstrained), the spec's documented no-schema case, so a partially-validated service still self-
 * describes its full topic list.
 */
import { Constructor, IServiceResolver, ServiceIdentifier, VoidResult } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { IMessageHandlerDefinitionLookUp } from '@benzene/abstractions-message-handlers';
import { ITypeJsonSchemaSource } from '@benzene/abstractions-validation';
import { IMeshSchemaProvider, MeshTopicSchemas } from './MeshSchemaProvider';

export class ValidationMeshSchemaProvider implements IMeshSchemaProvider {
  constructor(
    private readonly lookUp: IMessageHandlerDefinitionLookUp,
    private readonly sources: readonly ITypeJsonSchemaSource[],
  ) {}

  getSchemas(topic: ITopic): MeshTopicSchemas {
    const definition = this.lookUp.findHandler(topic);
    if (definition === undefined) {
      return {};
    }

    const schemas: MeshTopicSchemas = {};
    const request = this.schemaFor(definition.requestType);
    if (request !== undefined) {
      schemas.request = request;
    }
    const response = this.schemaFor(definition.responseType);
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
 * Builds a `ValidationMeshSchemaProvider` from the container: the handler lookup plus every registered
 * `ITypeJsonSchemaSource` (whatever validation adapters — or a hand-registered source — are wired). Pass the
 * result to `MeshDescriptorFactory.create` so the descriptor carries payload schemas.
 */
export function validationMeshSchemaProvider(resolver: IServiceResolver): ValidationMeshSchemaProvider {
  return new ValidationMeshSchemaProvider(
    resolver.getService(IMessageHandlerDefinitionLookUp),
    resolver.getServices(ITypeJsonSchemaSource),
  );
}
