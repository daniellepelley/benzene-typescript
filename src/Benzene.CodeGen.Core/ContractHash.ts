/**
 * The Contract Document's two hashes (contract-document.md §6): `contractHash` over `{requests, events}`
 * and `registrationHash` over `{requests, events, sends}`, each
 * `"sha256:" + lowercase-hex(sha256(JCS(P)))` of a projection P of the document. Port of
 * `Benzene.CodeGen.Core.ContractHash`.
 *
 * One implementation, shared by everything that hashes a contract: `@benzenejs/schema-openapi` stamps both
 * values on every document it emits, `@benzenejs/codegen-client` embeds the `contractHash` of the
 * projection a generated client covers, and the conformance runner checks
 * `conformance/contract-hash-cases.json` against it. Health checks and the mesh aggregator do not hash at
 * all: they read the served `contractHash` (contract-document.md §6.1).
 *
 * The projection (§6.2):
 * 1. **Members** - `requests` and `events` (and `sends`, always present, for `registrationHash`); nothing
 *    else, so identity, endpoints, transports, `components` and any future field are outside it.
 * 2. **Entries** - an entry whose topic starts `benzene:` is dropped; each kept entry keeps only its
 *    allow-listed members.
 * 3. **Dereference** - every `$ref` is replaced by its component, normalized the same way; a reference to a
 *    component already being expanded on the current path becomes `{}`, and a nullable reference wrapper
 *    around such a cut becomes `{}` as a whole.
 * 4. **Annotations** - documentation keywords and `x-*` are removed at every schema position; `required` is
 *    sorted (and dropped when empty); an empty `properties` is dropped.
 * 5. **Order** - entries sort by topic, then version (absent first); `httpMappings` methods are upper-cased
 *    and the mappings sorted by (method, path).
 */
import { createHash } from 'node:crypto';
import { JsonCanonicalizer } from './JsonCanonicalizer';

/** A JSON object, as the hashes read a Contract Document: plain parsed JSON, no class instances. */
export type JsonObject = Record<string, unknown>;

/** The two hashes of one document. */
export interface ContractHashes {
  readonly contractHash: string;
  readonly registrationHash: string;
}

/** The prefix every `$ref` in a Contract Document carries (contract-document.md §1). */
export const ComponentRefPrefix = '#/components/schemas/';

/** The topic prefix reserved for Benzene's own topics; such entries are never part of a contract. */
const ReservedTopicPrefix = 'benzene:';

/** The schema keywords removed before hashing (contract-document.md §6.2 step 4), besides every `x-*`. */
export const AnnotationKeywords: ReadonlySet<string> = new Set([
  'title',
  'description',
  'default',
  'examples',
  'example',
  'deprecated',
  'readOnly',
  'writeOnly',
  '$comment',
  '$id',
  '$schema',
  'format',
]);

type Member = 'requests' | 'events' | 'sends';

const EntryMembers: Readonly<Record<Member, readonly string[]>> = {
  requests: ['topic', 'version', 'httpMappings', 'request', 'response'],
  events: ['topic', 'version', 'message'],
  sends: ['topic', 'version', 'request', 'response'],
};

const SchemaMembers: ReadonlySet<string> = new Set(['request', 'response', 'message']);

export const ContractHash = {
  /** `contractHash`: the hash of `{requests, events}` (contract-document.md §6.1). */
  computeContractHash(document: object): string {
    return hash(project(document as JsonObject, ['requests', 'events']));
  },

  /** `registrationHash`: the hash of `{requests, events, sends}` (contract-document.md §6.1). */
  computeRegistrationHash(document: object): string {
    return hash(project(document as JsonObject, ['requests', 'events', 'sends']));
  },

  /** Both hashes of `document`. */
  compute(document: object): ContractHashes {
    return {
      contractHash: ContractHash.computeContractHash(document),
      registrationHash: ContractHash.computeRegistrationHash(document),
    };
  },

  /**
   * The projection P itself (steps 1-5), before canonicalization: exposed so a drift tool can show what
   * differs, and so tests can assert the steps directly.
   */
  project(document: object, includeSends: boolean): JsonObject {
    return project(document as JsonObject, includeSends ? ['requests', 'events', 'sends'] : ['requests', 'events']);
  },

  /**
   * Steps 3-4 applied to one schema: dereferenced against `components`, annotations removed, `required`
   * sorted. Two schemas describe the same wire shape exactly when their normalized forms are equal - the
   * comparison the naming rule (contract-document.md §4.1 rule 4) and the derivation cases use.
   */
  normalizeSchema(schema: unknown, components: Readonly<Record<string, unknown>> = {}): unknown {
    return normalizeSchema(schema, components, new Set<string>());
  },
} as const;

function hash(projection: JsonObject): string {
  const canonical = JsonCanonicalizer.canonicalize(projection);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function project(document: JsonObject, members: readonly Member[]): JsonObject {
  const components = componentsOf(document);
  const projection: JsonObject = {};
  for (const member of members) {
    const entries: JsonObject[] = [];
    const source = document[member];
    for (const raw of Array.isArray(source) ? source : []) {
      if (!isObject(raw)) {
        continue;
      }
      const topic = typeof raw['topic'] === 'string' ? raw['topic'] : '';
      if (topic.startsWith(ReservedTopicPrefix)) {
        continue;
      }
      entries.push(projectEntry(raw, member, components));
    }
    entries.sort(compareEntries);
    projection[member] = entries;
  }
  return projection;
}

function projectEntry(entry: JsonObject, member: Member, components: Record<string, unknown>): JsonObject {
  const projected: JsonObject = {};
  for (const field of EntryMembers[member]) {
    if (!(field in entry) || entry[field] === undefined) {
      continue;
    }
    const value = entry[field];
    if (SchemaMembers.has(field)) {
      projected[field] = normalizeSchema(value, components, new Set<string>());
    } else if (field === 'httpMappings') {
      projected[field] = projectHttpMappings(value);
    } else {
      projected[field] = structuredClone(value);
    }
  }
  return projected;
}

function projectHttpMappings(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return structuredClone(value);
  }
  return value
    .map((mapping) => {
      const record = isObject(mapping) ? mapping : {};
      return { method: String(record['method'] ?? '').toUpperCase(), path: String(record['path'] ?? '') };
    })
    .sort((a, b) => ordinal(a.method, b.method) || ordinal(a.path, b.path));
}

function compareEntries(a: JsonObject, b: JsonObject): number {
  const byTopic = ordinal(String(a['topic'] ?? ''), String(b['topic'] ?? ''));
  if (byTopic !== 0) {
    return byTopic;
  }
  const aHas = 'version' in a;
  const bHas = 'version' in b;
  if (aHas !== bHas) {
    return aHas ? 1 : -1;
  }
  return ordinal(String(a['version'] ?? ''), String(b['version'] ?? ''));
}

function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeSchema(schema: unknown, components: Readonly<Record<string, unknown>>, path: Set<string>): unknown {
  return normalize(schema, components, path).value;
}

interface Normalized {
  readonly value: unknown;
  /** True when this position was a reference cut at a cycle (§6.2 step 3). */
  readonly cut: boolean;
}

function normalize(schema: unknown, components: Readonly<Record<string, unknown>>, path: Set<string>): Normalized {
  if (!isObject(schema)) {
    return { value: structuredClone(schema), cut: false };
  }

  // A Reference Object: its siblings are ignored, as OpenAPI 3.0 ignores them.
  if (typeof schema['$ref'] === 'string') {
    const name = refName(schema['$ref']);
    if (path.has(name)) {
      return { value: {}, cut: true };
    }
    const inner = new Set(path);
    inner.add(name);
    return { value: normalize(components[name] ?? {}, components, inner).value, cut: false };
  }

  const out: JsonObject = {};
  let cutMembers: boolean[] | undefined;
  for (const [key, value] of Object.entries(schema)) {
    if (AnnotationKeywords.has(key) || key.startsWith('x-')) {
      continue;
    }
    if (key === 'properties' && isObject(value)) {
      const properties: JsonObject = {};
      for (const [name, property] of Object.entries(value)) {
        properties[name] = normalizeSchema(property, components, path);
      }
      out[key] = properties;
    } else if ((key === 'items' || key === 'additionalProperties' || key === 'not') && isObject(value)) {
      out[key] = normalizeSchema(value, components, path);
    } else if ((key === 'allOf' || key === 'anyOf' || key === 'oneOf') && Array.isArray(value)) {
      const members = value.map((member) => normalize(member, components, path));
      out[key] = members.map((member) => member.value);
      if (key === 'allOf') {
        cutMembers = members.map((member) => member.cut);
      }
    } else if (key === 'required' && Array.isArray(value)) {
      if (value.length > 0) {
        out[key] = [...value].map(String).sort(ordinal);
      }
    } else if (key === 'discriminator' && isObject(value)) {
      // `discriminator.mapping` holds component names, which are not contract (§6.2 step 4).
      const { mapping: _mapping, ...discriminator } = value;
      out[key] = structuredClone(discriminator);
    } else {
      out[key] = structuredClone(value);
    }
  }

  if (isObject(out['properties']) && Object.keys(out['properties']).length === 0) {
    delete out['properties'];
  }

  // The §4.2 nullable wrapper around a reference cut at a cycle becomes `{}` as a whole: members exactly
  // `nullable: true`, optionally `type`, and an `allOf` whose one member was a cut reference.
  const keys = Object.keys(out);
  const isCutWrapper =
    out['nullable'] === true &&
    keys.every((key) => key === 'type' || key === 'nullable' || key === 'allOf') &&
    cutMembers !== undefined &&
    cutMembers.length === 1 &&
    cutMembers[0] === true;
  return { value: isCutWrapper ? {} : out, cut: false };
}

function refName(ref: string): string {
  return ref.startsWith(ComponentRefPrefix) ? ref.slice(ComponentRefPrefix.length) : ref;
}

function componentsOf(document: JsonObject): Record<string, unknown> {
  const components = document['components'];
  if (!isObject(components)) {
    return {};
  }
  const schemas = components['schemas'];
  return isObject(schemas) ? schemas : {};
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
