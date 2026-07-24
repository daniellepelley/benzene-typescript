/** Port of Benzene.Mesh.Contracts.MeshHashing. */
import { createHmac } from 'node:crypto';

/**
 * Computes the hash used to detect a service's contract drift between mesh aggregator runs - deliberately
 * the same algorithm as the generated-SDK contract hash, so the mesh's drift flag means the same thing as
 * that existing check.
 *
 * C# `new HMACSHA256(Array.Empty<byte>()).ComputeHash(UTF8(json))` then lowercase hex, no separator ->
 * `node:crypto` `createHmac('sha256', Buffer.alloc(0))` with a `'hex'` digest (already lowercase).
 */
export const MeshHashing = {
  /** Computes the contract-drift hash of a raw spec document JSON string (lowercase hex, no prefix). */
  computeHash(json: string): string {
    return createHmac('sha256', Buffer.alloc(0)).update(json, 'utf8').digest('hex');
  },
};
