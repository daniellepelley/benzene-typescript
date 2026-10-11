/**
 * Parses a Contract Document (`.spec.json`, contract-document.md §1-§4) into a `ContractDocument`.
 * Port of the *read* side of `Benzene.Schema.OpenApi.EventService.EventServiceDocumentDeserializer` -
 * see `ContractDocument.ts`'s header for why this reads into a plain interface rather than the
 * existing `@benzenejs/schema-openapi` write-side model.
 *
 * Structural validation only: `schemaDialect` must be one this reader knows (`openapi-3.0`) - a document
 * in any other dialect is rejected with {@link UnknownSchemaDialectError} (contract-document.md §1) - and
 * each entry needs its `topic`. A `benzene:`-prefixed entry is ignored, not listed (§1, §5.1); every
 * other unrecognized field is passed through untouched or ignored, the spec's "ignore what you don't
 * recognize" forward-compatibility posture.
 */
import {
  ContractDocument,
  ContractEvent,
  ContractRequestResponse,
  ContractSend,
  HttpMapping,
  OpenApiSchemaObject,
  SupportedSchemaDialect,
} from './ContractDocument';

/** Thrown when the input is not valid JSON, or is structurally not a Contract Document. */
export class ContractDocumentParseError extends Error {
  /** The conformance error kind (`conformance/README.md`), when there is one. */
  readonly kind: string = 'invalid-document';

  constructor(message: string) {
    super(message);
    this.name = 'ContractDocumentParseError';
  }
}

/** Thrown for a document whose `schemaDialect` this reader does not know (contract-document.md §1). */
export class UnknownSchemaDialectError extends ContractDocumentParseError {
  override readonly kind = 'unknown-schema-dialect';

  constructor(readonly schemaDialect: string | undefined) {
    super(
      schemaDialect === undefined
        ? `Contract Document has no 'schemaDialect'; this reader knows only '${SupportedSchemaDialect}'`
        : `Contract Document schemaDialect '${schemaDialect}' is not supported; this reader knows only ` +
            `'${SupportedSchemaDialect}'`,
    );
    this.name = 'UnknownSchemaDialectError';
  }
}

const ReservedTopicPrefix = 'benzene:';

/** Parses `source` (a JSON string, or an already-parsed object) into a `ContractDocument`. */
export function parseContractDocument(source: string | Record<string, unknown>): ContractDocument {
  const root = typeof source === 'string' ? parseJson(source) : source;

  const dialect = root['schemaDialect'];
  if (dialect !== SupportedSchemaDialect) {
    throw new UnknownSchemaDialectError(typeof dialect === 'string' ? dialect : undefined);
  }

  const componentsField = asObject(root['components'], 'components');
  const schemas =
    (componentsField !== undefined ? asObject(componentsField['schemas'], 'components.schemas') : undefined) ?? {};

  return {
    schemaDialect: dialect,
    service: asOptionalString(root['service'], 'service') ?? '',
    serviceVersion: asOptionalString(root['serviceVersion'], 'serviceVersion'),
    versionScheme: asOptionalString(root['versionScheme'], 'versionScheme'),
    description: asOptionalString(root['description'], 'description'),
    messageEndpoint: asOptionalString(root['messageEndpoint'], 'messageEndpoint'),
    transports: asOptionalStringArray(root['transports'], 'transports'),
    contractHash: asOptionalString(root['contractHash'], 'contractHash'),
    registrationHash: asOptionalString(root['registrationHash'], 'registrationHash'),
    requests: entries(root['requests'], 'requests', readRequest),
    events: entries(root['events'], 'events', readEvent),
    sends: entries(root['sends'], 'sends', readSend),
    components: { schemas: schemas as Record<string, OpenApiSchemaObject> },
  };
}

/** Reads a list of entries, ignoring any whose topic is a reserved `benzene:` topic. */
function entries<T extends { topic: string }>(
  value: unknown,
  path: string,
  read: (json: Record<string, unknown>, at: string) => T,
): T[] {
  return asArray(value, path)
    .map((raw, index) => {
      const at = `${path}[${index}]`;
      const json = asObject(raw, at);
      if (json === undefined || typeof json['topic'] !== 'string') {
        throw new ContractDocumentParseError(`${at} is missing its required 'topic'`);
      }
      return read(json, at);
    })
    .filter((entry) => !entry.topic.startsWith(ReservedTopicPrefix));
}

function readRequest(json: Record<string, unknown>, at: string): ContractRequestResponse {
  const request: ContractRequestResponse = {
    topic: json['topic'] as string,
    version: asOptionalString(json['version'], `${at}.version`),
    httpMappings: readHttpMappings(json['httpMappings'], at),
    request: readSchema(json['request']),
  };
  if (json['response'] !== undefined) {
    request.response = readSchema(json['response']);
  }
  if (json['example'] !== undefined) {
    request.example = json['example'];
  }
  return request;
}

function readEvent(json: Record<string, unknown>, at: string): ContractEvent {
  const event: ContractEvent = {
    topic: json['topic'] as string,
    version: asOptionalString(json['version'], `${at}.version`),
    message: readSchema(json['message']),
  };
  if (json['example'] !== undefined) {
    event.example = json['example'];
  }
  return event;
}

function readSend(json: Record<string, unknown>, at: string): ContractSend {
  const send: ContractSend = {
    topic: json['topic'] as string,
    version: asOptionalString(json['version'], `${at}.version`),
    request: readSchema(json['request']),
  };
  if (json['response'] !== undefined) {
    send.response = readSchema(json['response']);
  }
  return send;
}

function readHttpMappings(value: unknown, at: string): HttpMapping[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const array = asArray(value, `${at}.httpMappings`);
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
