/** Port of Benzene.Core.Versioning.Schemas.ISchemaCasters. */
import { Constructor, ServiceToken, serviceToken } from '@benzene/abstractions';
import { ISchemaCaster } from './ISchemaCaster';

/**
 * The registered set of schema casters, with the O(1) lookups the per-message request/response casting
 * paths need. C#'s `bool TryGet(..., out caster)` -> return `ISchemaCaster | undefined` (the port's
 * try-get convention). The two `TryGetSchemaCaster` overloads (distinguished in C# by `string`-vs-`Type`
 * parameter) are expressed as TypeScript overloads, distinguished at runtime by `typeof` on the 2nd arg.
 */
export interface ISchemaCasters {
  getAll(): ISchemaCaster[];

  /** Finds the caster for `(topic, fromSchema -> toSchema)`, throwing if none is registered. */
  getSchemaCaster(fromSchema: string, toSchema: string, topic: string): ISchemaCaster;

  /**
   * Request (upcast) path: finds the caster for `topic` converting from schema `fromSchema` into the CLR
   * type `toType`.
   */
  tryGetSchemaCaster(topic: string, fromSchema: string, toType: Constructor<unknown>): ISchemaCaster | undefined;

  /**
   * Response (downcast) path: finds the caster for `topic` converting from the CLR type `fromType` into
   * schema `toSchema`.
   */
  tryGetSchemaCaster(topic: string, fromType: Constructor<unknown>, toSchema: string): ISchemaCaster | undefined;
}

/** Container token: registered as a singleton by `registerPayloadSchemaVersions`. */
export const ISchemaCasters: ServiceToken<ISchemaCasters> = serviceToken<ISchemaCasters>('ISchemaCasters');
