import { Constructor, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { ComponentRefPrefix, ContractHash } from '@benzenejs/codegen-core';
import { ComponentNameCollisionError } from './ComponentNameCollisionError';
import { ISchemaBuilder } from './ISchemaBuilder';

/** A schema claimed under one component name, with what claimed it (for the collision error). */
interface Claim {
  readonly schema: Record<string, unknown>;
  /** The claim's own named sub-schemas, already renamed into `components.schemas` keys. */
  readonly local: Record<string, unknown>;
  readonly owner: string;
  readonly usages: Set<string>;
}

/**
 * The default `ISchemaBuilder`. Where C#'s `SchemaBuilder` generates schemas with Swashbuckle by reflecting
 * over the CLR type, this sources them from the registered `ITypeJsonSchemaSource`s (validation-derived or
 * bring-your-own) — the runtime replacement for reflection.
 *
 * Naming and hoisting follow contract-document.md §4.1:
 * - every registered payload type is hoisted under its **declared schema name** (the source's
 *   `getSchemaName`, e.g. Zod `.meta({ id })`), else its class name; a source's named sub-schemas
 *   (`$defs`) are hoisted too, and a recursive type refers to itself by `$ref`;
 * - names keep only `[A-Za-z0-9._-]`; a type with no usable name (an anonymous class) is inlined;
 * - two schemas that differ after normalization (§6.2 steps 3–4) under one name **fail derivation** with a
 *   {@link ComponentNameCollisionError} naming both types, the topics that use them and the remedy — never a
 *   suffix, never first-wins; identical schemas share the entry. So registration order never decides a
 *   name, and the catalogue is the same on every build.
 */
export class SchemaBuilder implements ISchemaBuilder {
  private readonly claims = new Map<string, Claim>();

  constructor(private readonly sources: readonly ITypeJsonSchemaSource[] = []) {}

  build(): Record<string, Record<string, unknown>> {
    const sorted: Record<string, Record<string, unknown>> = {};
    for (const key of [...this.claims.keys()].sort()) {
      sorted[key] = this.claims.get(key)!.schema;
    }
    return sorted;
  }

  addSchema(type: ServiceIdentifier<unknown>, usage?: string): Record<string, unknown> {
    if (typeof type !== 'function' || type === VoidResult) {
      return {};
    }
    const ctor = type as Constructor<unknown>;
    const resolved = this.resolve(ctor);
    if (resolved === undefined) {
      return {};
    }
    const name = sanitize(resolved.declaredName ?? ctor.name);
    return this.addSourceSchema(name, resolved.schema, ctor.name || '(anonymous class)', usage);
  }

  addNamedSchema(schemaId: string, schema: Record<string, unknown>, usage?: string): Record<string, unknown> {
    const name = sanitize(schemaId);
    return this.addSourceSchema(name, schema, schemaId, usage);
  }

  private addSourceSchema(
    name: string,
    source: Record<string, unknown>,
    owner: string,
    usage: string | undefined,
  ): Record<string, unknown> {
    const { $defs, ...rootSchema } = source;
    const defs = isObject($defs) ? $defs : {};
    const defNames = new Map<string, string>();
    for (const defName of Object.keys(defs)) {
      defNames.set(defName, sanitize(defName));
    }
    const rootRef = name === '' ? undefined : `${ComponentRefPrefix}${name}`;
    const rewrite = (schema: unknown): unknown => rewriteRefs(schema, defNames, rootRef);

    const local: Record<string, unknown> = {};
    for (const [defName, defSchema] of Object.entries(defs)) {
      local[defNames.get(defName)!] = rewrite(defSchema);
    }
    const root = rewrite(rootSchema) as Record<string, unknown>;
    if (name !== '') {
      local[name] = root;
    }

    for (const [defName, defSchema] of Object.entries(defs)) {
      const key = defNames.get(defName)!;
      if (key === '') {
        continue;
      }
      this.claim(key, local[key] as Record<string, unknown>, local, `${key} (nested in ${owner})`, usage);
    }

    if (name === '') {
      return root;
    }
    this.claim(name, root, local, owner, usage);
    return { $ref: `${ComponentRefPrefix}${name}` };
  }

  private claim(
    name: string,
    schema: Record<string, unknown>,
    local: Record<string, unknown>,
    owner: string,
    usage: string | undefined,
  ): void {
    const existing = this.claims.get(name);
    if (existing === undefined) {
      this.claims.set(name, { schema, local, owner, usages: new Set(usage === undefined ? [] : [usage]) });
      return;
    }
    if (this.sameShape(existing.schema, existing.local, schema, local)) {
      if (usage !== undefined) {
        existing.usages.add(usage);
      }
      return;
    }
    throw new ComponentNameCollisionError(
      name,
      { type: existing.owner, usages: [...existing.usages] },
      { type: owner, usages: usage === undefined ? [] : [usage] },
    );
  }

  private sameShape(
    a: Record<string, unknown>,
    aLocal: Record<string, unknown>,
    b: Record<string, unknown>,
    bLocal: Record<string, unknown>,
  ): boolean {
    const catalogue = this.build();
    const left = ContractHash.normalizeSchema(a, { ...catalogue, ...aLocal });
    const right = ContractHash.normalizeSchema(b, { ...catalogue, ...bLocal });
    return JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));
  }

  private resolve(ctor: Constructor<unknown>): { schema: Record<string, unknown>; declaredName?: string } | undefined {
    for (const source of this.sources) {
      const schema = source.getJsonSchema(ctor);
      if (schema !== undefined) {
        return { schema, declaredName: source.getSchemaName?.(ctor) };
      }
    }
    return undefined;
  }
}

/** Component names keep only the OpenAPI 3.0 key characters (contract-document.md §4.1 rule 3). */
function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '');
}

/** Rewrites a source's local references (`#/$defs/N`, `#`) into `components.schemas` references. */
function rewriteRefs(schema: unknown, defNames: Map<string, string>, rootRef: string | undefined): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => rewriteRefs(item, defNames, rootRef));
  }
  if (!isObject(schema)) {
    return schema;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$ref' && typeof value === 'string') {
      const local = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(value);
      if (local !== null && defNames.has(local[1]!)) {
        out[key] = `${ComponentRefPrefix}${defNames.get(local[1]!)}`;
      } else if (value === '#') {
        if (rootRef === undefined) {
          // A recursive anonymous type has no component to point at: the recursion is unconstrained.
          return {};
        }
        out[key] = rootRef;
      } else {
        out[key] = value;
      }
    } else if (key === 'enum' || key === 'const' || key === 'default' || key === 'example' || key === 'examples') {
      out[key] = value;
    } else {
      out[key] = rewriteRefs(value, defNames, rootRef);
    }
  }
  return out;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (!isObject(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortKeys(value[key]);
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
