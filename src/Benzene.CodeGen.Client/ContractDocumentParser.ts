/**
 * Parses a Contract Document (`.spec.json`, contract-document.md §1-§4) into a `ContractDocument`.
 * Port of the *read* side of `Benzene.Schema.OpenApi.EventService.EventServiceDocumentDeserializer` -
 * see `ContractDocument.ts`'s header for why this reads into a plain interface rather than the
 * existing `@benzenejs/schema-openapi` write-side model.
 *
 * Structural validation only: required fields (`openapi`, each entry's `topic`) must be present with
 * the right JSON kind; every other field - including the whole top-level `tags` the .NET producer's
 * in-memory model still carries - is passed through untouched or ignored, matching the spec's
 * "ignore what you don't recognize" forward-compatibility posture (contract-document.md §1's
 * non-normative note).
 */
import {
  ContractDocument,
  ContractDocumentInfo,
  ContractEvent,
  ContractRequestResponse,
  HttpMapping,
  OpenApiSchemaObject,
} from './ContractDocument';

/** Thrown when the input is not valid JSON, or is structurally not a Contract Document. */
export class ContractDocumentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractDocumentParseError';
  }
}

/** Parses `source` (a JSON string, or an already-parsed object) into a `ContractDocument`. */
export function parseContractDocument(source: string | Record<string, unknown>): ContractDocument {
  const root = typeof source === 'string' ? parseJson(source) : source;

  if (root['openapi'] === undefined) {
    throw new ContractDocumentParseError("Contract Document is missing the required 'openapi' field");
  }

  const info = asObject(root['info'], 'info') ?? {};
  const componentsField = asObject(root['components'], 'components');
  const schemas =
    (componentsField !== undefined ? asObject(componentsField['schemas'], 'components.schemas') : undefined) ?? {};

  return {
    openapi: String(root['openapi']),
    info: readInfo(info),
    messageEndpoint: asOptionalString(root['messageEndpoint'], 'messageEndpoint'),
    transports: asOptionalStringArray(root['transports'], 'transports'),
    requests: asArray(root['requests'], 'requests').map(readRequest),
    events: asArray(root['events'], 'events').map(readEvent),
    components: { schemas: schemas as Record<string, OpenApiSchemaObject> },
  };
}

function readInfo(info: Record<string, unknown>): ContractDocumentInfo {
  return {
    title: asOptionalString(info['title'], 'info.title'),
    description: asOptionalString(info['description'], 'info.description'),
    version: asOptionalString(info['version'], 'info.version'),
  };
}

function readRequest(raw: unknown, index: number): ContractRequestResponse {
  const json = asObject(raw, `requests[${index}]`);
  if (json === undefined || typeof json['topic'] !== 'string') {
    throw new ContractDocumentParseError(`requests[${index}] is missing its required 'topic'`);
  }

  return {
    topic: json['topic'],
    version: asOptionalString(json['version'], `requests[${index}].version`),
    reserved: json['reserved'] === true ? true : undefined,
    httpMappings: readHttpMappings(json['httpMappings'], index),
    request: readSchema(json['request']),
    response: readSchema(json['response']),
    example: json['example'],
  };
}

function readEvent(raw: unknown, index: number): ContractEvent {
  const json = asObject(raw, `events[${index}]`);
  if (json === undefined || typeof json['topic'] !== 'string') {
    throw new ContractDocumentParseError(`events[${index}] is missing its required 'topic'`);
  }

  return {
    topic: json['topic'],
    version: asOptionalString(json['version'], `events[${index}].version`),
    message: readSchema(json['message']),
    example: json['example'],
  };
}

function readHttpMappings(value: unknown, requestIndex: number): HttpMapping[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const array = asArray(value, `requests[${requestIndex}].httpMappings`);
  return array.map((entry) => {
    const json = entry as Record<string, unknown>;
    return { method: String(json['method']), path: String(json['path']) };
  });
}

function readSchema(value: unknown): OpenApiSchemaObject {
  return (value as OpenApiSchemaObject | undefined) ?? {};
}

function parseJson(source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new ContractDocumentParseError(`Contract Document is not valid JSON: ${(error as Error).message}`);
  }
  const object = asObject(parsed, '$');
  if (object === undefined) {
    throw new ContractDocumentParseError('Contract Document must be a JSON object');
  }
  return object;
}

function asObject(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractDocumentParseError(`'${path}' must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ContractDocumentParseError(`'${path}' must be an array`);
  }
  return value;
}

function asOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ContractDocumentParseError(`'${path}' must be a string`);
  }
  return value;
}

function asOptionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return asArray(value, path).map((entry) => String(entry));
}
