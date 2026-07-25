/**
 * Port of Benzene.Conformance.Test.ConformanceFixtures.
 *
 * Loads the language-neutral fixture files (kept under `./fixtures`, copied verbatim from
 * docs/specification/conformance/ in the .NET repo) and provides the subset-matching JSON comparison
 * the fixture format specifies. Works on parsed JS values (`unknown`) rather than C# `JsonElement`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function load<T>(fileName: string): T {
  const path = fileURLToPath(new URL(`./fixtures/${fileName}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Asserts `expected` is a subset of `actual`: every property in an expected object must exist in the
 * actual value and match recursively; arrays must match exactly in length and order; primitives must
 * be equal. Extra properties in actual objects are ignored. Returns `null` on success, or a
 * description of the first mismatch.
 */
export function findSubsetMismatch(expected: unknown, actual: unknown, path = '$'): string | null {
  if (isObject(expected)) {
    if (!isObject(actual)) {
      return `${path}: expected an object but found ${describe(actual)}`;
    }
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) {
        return `${path}.${key}: missing`;
      }
      const mismatch = findSubsetMismatch(expected[key], actual[key], `${path}.${key}`);
      if (mismatch !== null) {
        return mismatch;
      }
    }
    return null;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return `${path}: expected an array but found ${describe(actual)}`;
    }
    if (expected.length !== actual.length) {
      return `${path}: expected ${expected.length} items but found ${actual.length}`;
    }
    for (let i = 0; i < expected.length; i++) {
      const mismatch = findSubsetMismatch(expected[i], actual[i], `${path}[${i}]`);
      if (mismatch !== null) {
        return mismatch;
      }
    }
    return null;
  }

  return expected === actual
    ? null
    : `${path}: expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
