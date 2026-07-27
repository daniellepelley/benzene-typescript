import { Constructor } from '@benzene/abstractions';
import { ITypeJsonSchemaSource } from '@benzene/abstractions-validation';
import { getJoiSchema } from './JoiSchemaRegistry';
import { joiToJsonSchema } from './joiToJsonSchema';

/**
 * An `ITypeJsonSchemaSource` backed by the registered Joi schemas: for a request/response type, it returns
 * the JSON Schema derived from that type's Joi schema (`JoiSchemaRegistry` → `joiToJsonSchema`), or
 * `undefined` when no Joi schema is registered for the type. Feeds a topic's payload schema into the
 * spec/mesh descriptor when a service validates with Joi. Registered by `useJoiValidation`.
 */
export class JoiJsonSchemaSource implements ITypeJsonSchemaSource {
  getJsonSchema(type: Constructor<unknown>): Record<string, unknown> | undefined {
    const schema = getJoiSchema(type);
    return schema === undefined ? undefined : joiToJsonSchema(schema);
  }
}
