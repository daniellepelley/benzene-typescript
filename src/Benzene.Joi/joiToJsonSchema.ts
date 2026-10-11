import type { Schema } from 'joi';

/**
 * Converts a Joi schema to a JSON Schema object for use as a topic's request/response payload schema in the
 * benzene Contract Document.
 *
 * TypeScript-only file with no direct C# counterpart — the Joi counterpart of `Benzene.Zod`'s
 * `zodToJsonSchema`. Where `.NET` reflects over the CLR type for the base schema and folds FluentValidation
 * rules in via `OpenApiValidationSchemaBuilder`, TypeScript erases types, so the schema is derived from the
 * runtime Joi schema the service already registered to validate the type — which encodes shape *and* rules,
 * so one pass yields both. Joi has no native JSON-Schema export, so the mapping walks `schema.describe()`
 * (Joi's own structured introspection) rather than pulling in a third-party converter, keeping the adapter's
 * only runtime dependency Joi itself.
 *
 * The mapping is a documented subset (README "Porting conventions"), covering the constraints that have a
 * JSON Schema equivalent:
 *   object → type+properties+required   array → type+items+minItems/maxItems   string → type+minLength/
 *   maxLength/format(email,uri,uuid)/pattern   number → type(number|integer)+minimum/maximum/exclusive*
 *   .valid(...) → enum   boolean → type   date → string/date-time   .pattern(string, V) → map of V
 *   .allow(null) → nullable (contract-document.md §4.2's OpenAPI 3.0 forms).
 * A constraint with no JSON Schema keyword (e.g. a custom `.external()` check) is simply not represented —
 * the payload stays valid, just less constrained, exactly as the spec's unconstrained `{}` case allows.
 */
export function joiToJsonSchema(schema: Schema): Record<string, unknown> {
  return convert(schema.describe() as unknown as JoiDescription);
}

interface JoiRule {
  name: string;
  args?: Record<string, unknown>;
}

interface JoiDescription {
  type?: string;
  flags?: { presence?: string; only?: boolean; id?: string; default?: unknown };
  patterns?: { schema?: JoiDescription; rule?: JoiDescription }[];
  keys?: Record<string, JoiDescription>;
  items?: JoiDescription[];
  rules?: JoiRule[];
  allow?: unknown[];
}

function convert(desc: JoiDescription): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  const rules = desc.rules ?? [];

  switch (desc.type) {
    case 'object': {
      schema['type'] = 'object';
      const keys = desc.keys ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [name, child] of Object.entries(keys)) {
        properties[name] = convert(child);
        if (isAlwaysEmitted(child)) {
          required.push(name);
        }
      }
      if (Object.keys(properties).length > 0) {
        schema['properties'] = properties;
      }
      if (required.length > 0) {
        schema['required'] = required;
      }
      // `Joi.object().pattern(Joi.string(), V)` with no fixed keys is a string-keyed map of V.
      const pattern = desc.patterns?.[0]?.rule;
      if (Object.keys(properties).length === 0 && pattern !== undefined) {
        schema['additionalProperties'] = convert(pattern);
      }
      break;
    }
    case 'array': {
      schema['type'] = 'array';
      const items = desc.items ?? [];
      if (items.length === 1) {
        schema['items'] = convert(items[0]);
      } else if (items.length > 1) {
        schema['items'] = items.map(convert);
      }
      applyLimit(schema, rules, 'min', 'minItems');
      applyLimit(schema, rules, 'max', 'maxItems');
      applyLength(schema, rules, 'minItems', 'maxItems');
      break;
    }
    case 'string': {
      schema['type'] = 'string';
      applyLimit(schema, rules, 'min', 'minLength');
      applyLimit(schema, rules, 'max', 'maxLength');
      applyLength(schema, rules, 'minLength', 'maxLength');
      applyStringFormats(schema, rules);
      break;
    }
    case 'number': {
      schema['type'] = rules.some((r) => r.name === 'integer') ? 'integer' : 'number';
      applyLimit(schema, rules, 'min', 'minimum');
      applyLimit(schema, rules, 'max', 'maximum');
      applyLimit(schema, rules, 'greater', 'exclusiveMinimum');
      applyLimit(schema, rules, 'less', 'exclusiveMaximum');
      break;
    }
    case 'boolean':
      schema['type'] = 'boolean';
      break;
    case 'date':
      schema['type'] = 'string';
      schema['format'] = 'date-time';
      break;
    // 'any' / 'alternatives' / unknown → no `type` (unconstrained)
  }

  // `.valid(a, b, ...)` sets `flags.only` + `allow` — a closed set of values → JSON Schema `enum`.
  if (desc.flags?.only === true && Array.isArray(desc.allow) && desc.allow.length > 0) {
    schema['enum'] = desc.allow.filter((value) => value !== null);
  }

  // `.allow(null)` (or `.valid(..., null)`) makes the value nullable (contract-document.md §4.2).
  if (Array.isArray(desc.allow) && desc.allow.includes(null)) {
    return applyNullable(schema);
  }

  return schema;
}

/**
 * Whether an object key is always present once Joi has validated the object, which makes it `required`
 * (contract-document.md §4.2: `required` describes the payload as written, defaults included): a
 * `.required()` key, or one with a declared `.default(...)` - Joi fills it in when it is absent, so the
 * value the service holds always carries it. A `.forbidden()` key never appears.
 */
function isAlwaysEmitted(desc: JoiDescription): boolean {
  const flags = desc.flags;
  if (flags === undefined || flags.presence === 'forbidden') {
    return false;
  }
  // `in`, not `!== undefined`: a function default (`.default(() => v)`) describes with no value, and Joi
  // refuses `.default(undefined)`, so the key's presence is the declaration.
  return flags.presence === 'required' || 'default' in flags;
}

/** The schema's declared name: its Joi `.id()` (contract-document.md §4.1 rule 5). */
export function joiSchemaName(schema: Schema): string | undefined {
  const id = (schema.describe() as unknown as JoiDescription).flags?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * Applies `nullable` the way the derivation table does (contract-document.md §4.2): a nullable object or
 * enum is the wrapper `{"type":<T's type>,"nullable":true,"allOf":[T]}`; a nullable primitive, array or
 * map is its own schema plus `"nullable": true`.
 */
function applyNullable(schema: Record<string, unknown>): Record<string, unknown> {
  const isMap = schema['type'] === 'object' && schema['properties'] === undefined && schema['additionalProperties'] !== undefined;
  if ((schema['type'] === 'object' && !isMap) || Array.isArray(schema['enum'])) {
    const inner = { ...schema };
    if (Array.isArray(inner['enum'])) {
      inner['enum'] = (inner['enum'] as unknown[]).filter((value) => value !== null);
    }
    const wrapper: Record<string, unknown> = { nullable: true, allOf: [inner] };
    return inner['type'] === undefined ? wrapper : { type: inner['type'], ...wrapper };
  }
  return { ...schema, nullable: true };
}


/** Copies a numeric `limit` rule onto the target keyword (skips non-numeric limits, e.g. Joi refs). */
function applyLimit(
  schema: Record<string, unknown>,
  rules: JoiRule[],
  ruleName: string,
  keyword: string,
): void {
  const limit = rules.find((r) => r.name === ruleName)?.args?.['limit'];
  if (typeof limit === 'number') {
    schema[keyword] = limit;
  }
}

/** A `.length(n)` rule pins both bounds to the same value. */
function applyLength(
  schema: Record<string, unknown>,
  rules: JoiRule[],
  minKeyword: string,
  maxKeyword: string,
): void {
  const limit = rules.find((r) => r.name === 'length')?.args?.['limit'];
  if (typeof limit === 'number') {
    schema[minKeyword] = limit;
    schema[maxKeyword] = limit;
  }
}

function applyStringFormats(schema: Record<string, unknown>, rules: JoiRule[]): void {
  for (const rule of rules) {
    switch (rule.name) {
      case 'email':
        schema['format'] = 'email';
        break;
      case 'uri':
        schema['format'] = 'uri';
        break;
      case 'guid':
      case 'uuid':
        schema['format'] = 'uuid';
        break;
      case 'isoDate':
        schema['format'] = 'date-time';
        break;
      case 'pattern': {
        const regex = rule.args?.['regex'];
        if (typeof regex === 'string') {
          schema['pattern'] = unwrapRegex(regex);
        } else if (regex instanceof RegExp) {
          schema['pattern'] = regex.source;
        }
        break;
      }
    }
  }
}

/** Joi serializes a pattern regex as `"/source/flags"`; JSON Schema wants the bare source. */
function unwrapRegex(value: string): string {
  const match = /^\/(.*)\/[a-z]*$/s.exec(value);
  return match !== null ? match[1] : value;
}
