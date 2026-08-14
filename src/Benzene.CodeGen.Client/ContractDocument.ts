/**
 * The Contract Document (docs/specification/contract-document.md): the `{Service}.spec.json` shape a
 * client generator parses - `{ openapi, info, messageEndpoint?, transports?, requests[], events[],
 * components.schemas }`, with every `$ref` pointing into `#/components/schemas/<name>`.
 *
 * Plain, JSON-shaped interfaces rather than classes: a parsed Contract Document already *is* this
 * shape, so no read/write model conversion is needed anywhere in the pipeline (parse → topic-scope →
 * schema-closure → contractHash all operate on the same plain objects). This deliberately does not
 * reuse `@benzenejs/schema-openapi`'s `EventServiceDocument`/`RequestResponse`/`Event` - that model is
 * producer-oriented (built by `EventServiceDocumentBuilder` from a live handler registry, schemas
 * always pre-resolved to a `$ref` by its `ISchemaBuilder`) and carries no `$ref`-following,
 * `allOf`/`oneOf`/`anyOf` composition, or discriminator support, none of which a client generator
 * reading someone else's committed document can do without. See the README Porting-conventions table.
 */

export interface ContractDocumentInfo {
  title?: string;
  description?: string;
  version?: string;
}

export interface HttpMapping {
  method: string;
  path: string;
}

/**
 * An OpenAPI 3.0 Schema Object, or a `$ref` into `#/components/schemas/<name>` - the subset a
 * Contract Document needs (contract-document.md §4, §5.3). Extra/unrecognized members are kept
 * (`[key: string]: unknown`) so a document round-trips through `contractHash`'s normalize step
 * without silently dropping fields this reader doesn't specifically model.
 */
export interface OpenApiSchemaObject {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  nullable?: boolean;
  properties?: Record<string, OpenApiSchemaObject>;
  required?: string[];
  items?: OpenApiSchemaObject;
  additionalProperties?: OpenApiSchemaObject | boolean;
  allOf?: OpenApiSchemaObject[];
  anyOf?: OpenApiSchemaObject[];
  oneOf?: OpenApiSchemaObject[];
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  enum?: unknown[];
  [key: string]: unknown;
}

/** One `requests[]` entry (contract-document.md §2): a request/response ("RPC-shaped") topic. */
export interface ContractRequestResponse {
  topic: string;
  /** The handler version (core-concepts.md §2). Absent means the unversioned handler - never `""`. */
  version?: string;
  /** True only when this is a reserved Benzene utility topic; never written as `false`. */
  reserved?: boolean;
  httpMappings?: HttpMapping[];
  request: OpenApiSchemaObject;
  response: OpenApiSchemaObject;
  example?: unknown;
}

/** One `events[]` entry (contract-document.md §3): a produced, fire-and-forget topic. */
export interface ContractEvent {
  topic: string;
  version?: string;
  message: OpenApiSchemaObject;
  example?: unknown;
}

/** The full top-level shape (contract-document.md §1). */
export interface ContractDocument {
  openapi: string;
  info: ContractDocumentInfo;
  messageEndpoint?: string;
  transports?: string[];
  requests: ContractRequestResponse[];
  events: ContractEvent[];
  components: { schemas: Record<string, OpenApiSchemaObject> };
}

/**
 * The catalogue name a `$ref` points to, e.g. `"#/components/schemas/PaymentDto"` -> `"PaymentDto"`.
 * Throws on any other ref shape - contract-document.md §4 requires every `$ref` in a Contract Document
 * to point into `#/components/schemas/<name>`, no external or relative refs.
 */
export function refName(ref: string): string {
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix)) {
    throw new Error(`Unsupported $ref '${ref}': a Contract Document's refs must point into ${prefix}<name>`);
  }
  return ref.slice(prefix.length);
}
