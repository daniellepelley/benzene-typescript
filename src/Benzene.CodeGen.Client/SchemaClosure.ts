/**
 * The single schema-closure walk shared by `buildAtomicClientSdk` (to build a topic-scoped client's
 * narrowed `components.schemas`) and the conformance test runner (`contract-document-cases.json`'s
 * `schemaClosureCases`, contract-document.md §5.3). Walks `$ref`, `items`, `additionalProperties`,
 * `properties`, and `allOf`/`anyOf`/`oneOf`, cycle-safe via the reached-set. Port of
 * `Benzene.CodeGen.Client.SchemaClosure`.
 */
import { OpenApiSchemaObject, refName } from './ContractDocument';

/** The set of catalogue schema names reachable from `roots`, per contract-document.md §5.3's walk. */
export function reachableSchemaNames(
  catalogue: Record<string, OpenApiSchemaObject>,
  ...roots: Array<OpenApiSchemaObject | undefined>
): Set<string> {
  const reached = new Set<string>();

  function walk(schema: OpenApiSchemaObject | undefined): void {
    if (schema === undefined) {
      return;
    }

    // reached.add before recursing is what makes a $ref cycle terminate: the second time the walk
    // reaches an already-visited name, this guard is false and it isn't walked again.
    if (schema.$ref !== undefined) {
      const name = refName(schema.$ref);
      if (name in catalogue && !reached.has(name)) {
        reached.add(name);
        walk(catalogue[name]);
      }
    }

    walk(schema.items);
    if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
      walk(schema.additionalProperties);
    }
    if (schema.properties !== undefined) {
      for (const property of Object.values(schema.properties)) {
        walk(property);
      }
    }
    for (const composed of [...(schema.allOf ?? []), ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
      walk(composed);
    }
  }

  for (const root of roots) {
    walk(root);
  }

  return reached;
}

/** `catalogue` narrowed to exactly the entries `reachableSchemaNames` reports reachable from `roots`. */
export function reachableSchemas(
  catalogue: Record<string, OpenApiSchemaObject>,
  ...roots: Array<OpenApiSchemaObject | undefined>
): Record<string, OpenApiSchemaObject> {
  const reached = reachableSchemaNames(catalogue, ...roots);
  const result: Record<string, OpenApiSchemaObject> = {};
  for (const name of Object.keys(catalogue)) {
    if (reached.has(name)) {
      result[name] = catalogue[name];
    }
  }
  return result;
}
