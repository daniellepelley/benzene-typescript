import { Constructor } from '@benzene/abstractions';
import { ITypeJsonSchemaSource } from '@benzene/abstractions-validation';
import { getYupSchema } from './YupSchemaRegistry';
import { yupToJsonSchema } from './yupToJsonSchema';

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
}
