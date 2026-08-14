/** Port of Benzene.Schema.OpenApi.OpenApi.OpenApiDocumentBuilder (the `openapi` document format). */
import { IApplicationInfo, IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { IHttpEndpointDefinition } from '@benzenejs/http';
import { ISchemaBuilder } from '../ISchemaBuilder';
import { SchemaBuilder } from '../SchemaBuilder';

/** The `info` object of an OpenAPI document. */
export interface OpenApiInfo {
  title?: string;
  description?: string;
  version?: string;
}

/** An OpenAPI `tag` (a named grouping for operations). */
export interface OpenApiTag {
  name: string;
  description?: string;
}

/**
 * The OpenAPI 3.0 spec version this builder emits (matching the C# builder's
 * `OpenApiSpecVersion.OpenApi3_0`).
 */
const OPEN_API_VERSION = '3.0.1';

/**
 * The set of HTTP methods OpenAPI recognises as path-item operations, keyed by upper-case method name and
 * mapping to the lower-case operation key used in the document. Mirrors the C# `MapOperationType` switch.
 */
const OPERATION_KEYS: Record<string, string> = {
  GET: 'get',
  PUT: 'put',
  POST: 'post',
  DELETE: 'delete',
  OPTIONS: 'options',
  HEAD: 'head',
  PATCH: 'patch',
  TRACE: 'trace',
};

/** The error responses every operation carries — HTTP status → its response description. */
const ERROR_RESPONSES: Record<string, string> = {
  '400': '400BadRequest',
  '401': '401Unauthorised',
  '403': '403Forbidden',
  '404': '404NotFound',
  '422': '422UnprocessableEntity',
  '500': '500InternalServerError',
  '503': '503ServiceUnavailable',
};

/**
 * The problem-details schema referenced by every error response. C# reflects `ErrorPayload` into a schema
 * (Swashbuckle); TypeScript erases types, so — as everywhere in this package — the shape is supplied
 * directly rather than reflected. Mirrors {@link ProblemDetails}: five optional string fields.
 */
const ERROR_PAYLOAD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'string' },
    detail: { type: 'string' },
    instance: { type: 'string' },
  },
};

/**
 * Builds a real **OpenAPI 3.0** document from a service's HTTP endpoints, delegating every payload schema to
 * the shared {@link ISchemaBuilder} (so each lives once in `components.schemas` and is referenced by
 * `$ref`). Port of Benzene.Schema.OpenApi.OpenApi.OpenApiDocumentBuilder — the C# `IConsumes*` feeds map to
 * plain `add*` methods, exactly as the sibling `EventServiceDocumentBuilder` does for the `benzene` format.
 *
 * Divergences from the C# original, both forced by the language:
 * - **Output.** C# hands the model to `Microsoft.OpenApi`'s serializer (JSON *or* YAML); the port emits the
 *   document as plain JSON with `JSON.stringify` (OpenAPI's universal interchange format) and does not carry
 *   a YAML dependency — `generateYaml` is intentionally absent, so `SpecBuilder` always serves JSON.
 * - **Response content type.** C# special-cases `IBase64JsonMessage` / `IRawStringMessage` response types
 *   via `Type.IsAssignableFrom`; those markers are erased on a TypeScript constructor, so every success
 *   response is modelled as `application/json` with the response `$ref`.
 */
export class OpenApiDocumentBuilder {
  private readonly paths: Record<string, Record<string, unknown>> = {};
  private readonly schemaBuilder: ISchemaBuilder;
  private info: OpenApiInfo = {};
  private readonly tags: OpenApiTag[] = [];

  constructor(schemaBuilder?: ISchemaBuilder) {
    this.schemaBuilder = schemaBuilder ?? new SchemaBuilder();
  }

  build(): Record<string, unknown> {
    return {
      openapi: OPEN_API_VERSION,
      info: this.info,
      tags: this.tags,
      paths: this.paths,
      components: { schemas: this.schemaBuilder.build() },
    };
  }

  generateJson(): string {
    return JSON.stringify(this.build());
  }

  addApplicationInfo(applicationInfo: IApplicationInfo): this {
    return this.addInfo({
      title: applicationInfo.name,
      description: applicationInfo.description,
      version: applicationInfo.version,
    });
  }

  addInfo(info: OpenApiInfo): this {
    this.info = info;
    return this;
  }

  addTag(tag: OpenApiTag): this {
    this.tags.push(tag);
    return this;
  }

  addHttpEndpointDefinitions(
    httpEndpointDefinitions: IHttpEndpointDefinition[],
    messageHandlerDefinitions: IMessageHandlerDefinition[],
  ): this {
    const byPath = new Map<string, IHttpEndpointDefinition[]>();
    for (const endpoint of httpEndpointDefinitions) {
      const path = getPath(endpoint);
      const group = byPath.get(path) ?? [];
      group.push(endpoint);
      byPath.set(path, group);
    }

    for (const [path, endpoints] of byPath) {
      this.addHttpEndpointDefinition(path, endpoints, messageHandlerDefinitions);
    }
    return this;
  }

  addHttpEndpointDefinition(
    path: string,
    httpEndpointDefinitions: IHttpEndpointDefinition[],
    messageHandlerDefinitions: IMessageHandlerDefinition[],
  ): void {
    const operations: Record<string, unknown> = {};
    for (const endpoint of httpEndpointDefinitions) {
      const [operationKey, operation] = this.createOperation(endpoint, messageHandlerDefinitions);
      operations[operationKey] = operation;
    }
    this.paths[path] = operations;
  }

  private createOperation(
    httpEndpointDefinition: IHttpEndpointDefinition,
    messageHandlerDefinitions: IMessageHandlerDefinition[],
  ): [string, Record<string, unknown>] {
    const operationKey = mapOperationKey(httpEndpointDefinition.method);
    const messageHandlerDefinition = messageHandlerDefinitions.find(
      (h) => h.topic.id === httpEndpointDefinition.topic,
    );

    const operation: Record<string, unknown> = {};

    const parameters = createParameters(httpEndpointDefinition.path);
    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    if (operationKey !== 'get' && messageHandlerDefinition !== undefined) {
      operation.requestBody = {
        content: {
          'application/json': { schema: this.schemaBuilder.addSchema(messageHandlerDefinition.requestType) },
        },
      };
    }

    operation.responses = this.createResponses(messageHandlerDefinition?.responseType);

    return [operationKey, operation];
  }

  private createResponses(responseType: IMessageHandlerDefinition['responseType'] | undefined): Record<string, unknown> {
    const responses: Record<string, unknown> = {
      '200': {
        description: 'OK',
        content:
          responseType === undefined
            ? undefined
            : { 'application/json': { schema: this.schemaBuilder.addSchema(responseType) } },
      },
    };

    const errorSchema = this.schemaBuilder.addNamedSchema('ErrorPayload', ERROR_PAYLOAD_SCHEMA);
    for (const [status, description] of Object.entries(ERROR_RESPONSES)) {
      responses[status] = {
        description,
        content: { 'application/json': { schema: errorSchema } },
      };
    }

    return responses;
  }
}

/** The path an endpoint sits under: lower-cased, with a guaranteed leading slash. Mirrors C# `GetPath`. */
function getPath(httpEndpointDefinition: IHttpEndpointDefinition): string {
  const path = httpEndpointDefinition.path.toLowerCase();
  return path.startsWith('/') ? path : `/${path}`;
}

/** Maps an HTTP method to its OpenAPI operation key; an empty method defaults to `post` (as in C#). */
function mapOperationKey(method: string): string {
  if (method === undefined || method === '') {
    return 'post';
  }
  return OPERATION_KEYS[method.toUpperCase()] ?? 'post';
}

/**
 * The `{name}` route parameters of a path, as OpenAPI path parameters (always required strings). Replaces
 * C#'s `TemplateParser.Parse(path).Parameters` with a token scan — the TS router uses the same `{name}`
 * pattern.
 */
function createParameters(path: string): Record<string, unknown>[] {
  const parameters: Record<string, unknown>[] = [];
  for (const match of path.matchAll(/\{([^}]+)\}/g)) {
    parameters.push({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  }
  return parameters;
}
