import { describe, expect, it } from 'vitest';
import { MeshHashing } from '@benzenejs/mesh-contracts';

/**
 * Port of test/Benzene.Mesh.Test/MeshHashingTest.cs. The C# cross-check against
 * `Benzene.CodeGen.Core.CodeGenHelpers.GenerateHash` can't be ported (CodeGen.Core isn't ported), so the
 * algorithm is instead pinned with known-answer digests (empty-key HMAC-SHA256, lowercase hex) - if the
 * implementation ever drifts, these break.
 */

describe('MeshHashing', () => {
  it.each([
    ['{}', '22f8eea909400af98adf3681a9f31923ef6b7fcba4abb553d92823a3e9d5c25e'],
    ['{"foo":"bar"}', 'cf68fe868a2cab3e7bb038ea475718cc2be01f699bcf5c69981712b8e7764292'],
    ['', 'b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad'],
  ])('ComputeHash(%j) is the pinned empty-key HMAC-SHA256 hex', (json, expected) => {
    expect(MeshHashing.computeHash(json)).toBe(expected);
  });

  it('ComputeHash_DifferentInput_DifferentHash', () => {
    expect(MeshHashing.computeHash('{"a":1}')).not.toBe(MeshHashing.computeHash('{"a":2}'));
  });
});
