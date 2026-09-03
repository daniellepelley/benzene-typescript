import type { Schema } from 'yup';

/**
 * Converts a Yup schema to a JSON Schema object for use as a topic's request/response payload schema in the
 * benzene spec / mesh descriptor.
 *
 * TypeScript-only file with no direct C# counterpart — the Yup counterpart of `Benzene.Zod`'s
 * `zodToJsonSchema`. TypeScript erases types, so the schema is derived from the runtime Yup schema the
 * service already registered to validate the type — which encodes shape *and* rules — by walking
 * `schema.describe()` (Yup's own introspection), so no third-party converter is pulled in and Yup stays the
 * adapter's only runtime dependency.
 *
 * Documented subset (README "Porting conventions"): object → type+properties+required, array →
 * type+items+minItems/maxItems, string → type+minLength/maxLength/format(email,uri,uuid)/pattern, number →
 * type(number|integer)+minimum/maximum/exclusive*, `.oneOf(...)` → enum, boolean → type, date →
 * string/date-time. A constraint with no JSON Schema keyword is left unrepresented (a valid, less-
 * constrained payload — the spec's unconstrained case). A field is `required` when Yup marks it non-optional
 * (`.required()`/`.defined()`).
 *
 * Yup names both bound tests `min`/`max` regardless of inclusivity and distinguishes them by which param is
 * present: `.min()`→`params.min`, `.moreThan()`→`params.more` (exclusive); `.max()`→`params.max`,
 * `.lessThan()`→`params.less` (exclusive) — so the mapping keys off the param, not the test name.
 */
export function yupToJsonSchema(schema: Schema): Record<string, unknown> {
  return convert(schema.describe() as unknown as YupDescription);
}

interface YupTest {
  name?: string;
  params?: Record<string, unknown>;
}

interface YupDescription {
  type?: string;
  optional?: boolean;
  oneOf?: unknown[];
  tests?: YupTest[];
  fields?: Record<string, YupDescription>;
  innerType?: YupDescription;
}

function convert(desc: YupDescription): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  const tests = desc.tests ?? [];

  switch (desc.type) {
    case 'object': {
      schema['type'] = 'object';
      const fields = desc.fields ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [name, child] of Object.entries(fields)) {
        properties[name] = convert(child);
        if (child.optional === false) {
          required.push(name);
        }
      }
      if (Object.keys(properties).length > 0) {
        schema['properties'] = properties;
      }
      if (required.length > 0) {
        // Ordinal sort (UTF-16 code units), matching .NET's MeshSchemaGenerator: `required` is a set, and
        // emitting it in field-declaration order would make the mesh descriptor (and its hash) depend on how
        // the Yup schema happened to list its fields.
        schema['required'] = required.sort();
      }
      break;
    }
    case 'array': {
      schema['type'] = 'array';
      if (desc.innerType !== undefined) {
        schema['items'] = convert(desc.innerType);
      }
      setNumber(schema, 'minItems', paramNum(tests, 'min', 'min'));
      setNumber(schema, 'maxItems', paramNum(tests, 'max', 'max'));
      applyLength(schema, tests, 'minItems', 'maxItems');
      break;
    }
    case 'string': {
      schema['type'] = 'string';
      setNumber(schema, 'minLength', paramNum(tests, 'min', 'min'));
      setNumber(schema, 'maxLength', paramNum(tests, 'max', 'max'));
      applyLength(schema, tests, 'minLength', 'maxLength');
      applyStringFormats(schema, tests);
      break;
    }
    case 'number': {
      schema['type'] = tests.some((t) => t.name === 'integer') ? 'integer' : 'number';
      setNumber(schema, 'minimum', paramNum(tests, 'min', 'min'));
      setNumber(schema, 'maximum', paramNum(tests, 'max', 'max'));
      setNumber(schema, 'exclusiveMinimum', paramNum(tests, 'min', 'more'));
      setNumber(schema, 'exclusiveMaximum', paramNum(tests, 'max', 'less'));
      break;
    }
    case 'boolean':
      schema['type'] = 'boolean';
      break;
    case 'date':
      schema['type'] = 'string';
      schema['format'] = 'date-time';
      break;
    // 'mixed' / 'tuple' / unknown → no `type` (unconstrained)
  }

  // `.oneOf([...])` is a closed set of allowed values → JSON Schema `enum`.
  if (Array.isArray(desc.oneOf) && desc.oneOf.length > 0) {
    schema['enum'] = [...desc.oneOf];
  }

  return schema;
}

/** The numeric value of `params[paramKey]` on the test named `testName`, or undefined. */
function paramNum(tests: YupTest[], testName: string, paramKey: string): number | undefined {
  const value = tests.find((t) => t.name === testName)?.params?.[paramKey];
  return typeof value === 'number' ? value : undefined;
}

function setNumber(schema: Record<string, unknown>, keyword: string, value: number | undefined): void {
  if (value !== undefined) {
    schema[keyword] = value;
  }
}

/** A `.length(n)` test pins both bounds to the same value. */
function applyLength(
  schema: Record<string, unknown>,
  tests: YupTest[],
  minKeyword: string,
  maxKeyword: string,
): void {
  const length = paramNum(tests, 'length', 'length');
  if (length !== undefined) {
    schema[minKeyword] = length;
    schema[maxKeyword] = length;
  }
}

function applyStringFormats(schema: Record<string, unknown>, tests: YupTest[]): void {
  for (const test of tests) {
    switch (test.name) {
      case 'email':
        schema['format'] = 'email';
        break;
      case 'url':
        schema['format'] = 'uri';
        break;
      case 'uuid':
        schema['format'] = 'uuid';
        break;
      case 'matches': {
        const regex = test.params?.['regex'];
        if (regex instanceof RegExp) {
          schema['pattern'] = regex.source;
        } else if (typeof regex === 'string') {
          schema['pattern'] = regex;
        }
        break;
      }
    }
  }
}
