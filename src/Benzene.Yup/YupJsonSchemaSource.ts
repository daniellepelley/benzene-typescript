import { Constructor } from '@benzenejs/abstractions';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { getYupSchema } from './YupSchemaRegistry';
import { yupSchemaName, yupToJsonSchema } from './yupToJsonSchema';

/**
 * An `ITypeJsonSchemaSource` backed by the registered Yup schemas: for a request/response type, it returns
 * the JSON Schema derived from that type's Yup schema (`YupSchemaRegistry` → `yupToJsonSchema`), or
 * `undefined` when no Yup schema is registered for the type. Feeds a topic's payload schema into the
 * spec/mesh descriptor when a service validates with Yup. Registered by `useYupValidation`.
 */
export class YupJsonSchemaSource implements ITypeJsonSchemaSource {
  getJsonSchema(type: Constructor<unknown>): Record<string, unknown> | undefined {
    const schema = getYupSchema(type);
    return schema === undefined ? undefined : yupToJsonSchema(schema);
  }

  /** The schema's declared name: its Yup `.meta({ id })` (contract-document.md §4.1 rule 5). */
  getSchemaName(type: Constructor<unknown>): string | undefined {
    const schema = getYupSchema(type);
    return schema === undefined ? undefined : yupSchemaName(schema);
  }
}
