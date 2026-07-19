/** Port of Benzene.Extras.Patches.PatchExtensions. */
import { IPatchMessage } from './IPatchMessage';

/**
 * Helpers for reading and writing patch fields while tracking which were explicitly set.
 * Port of Benzene.Extras.Patches.PatchExtensions (C# extension methods → free functions).
 *
 * **Erasure handling.** The C# API identifies a field with an expression tree
 * (`Expression<Func<TUpdateMessage, TValue>>`), from which it reflects the member name and
 * lower-cases it. TypeScript has no expression trees, so the field is named directly by a typed
 * property key (`K extends keyof T & string`) — the idiomatic, type-safe equivalent. The stored and
 * compared form stays lower-cased exactly as in C#, so `updatedFields` holds lower-cased names and a
 * key differing only in case still matches.
 */

/** Port of C# `HasField(source, x => x.Field)` — true if `key` was explicitly set on `source`. */
export function hasField<T extends IPatchMessage, K extends keyof T & string>(source: T, key: K): boolean {
  return source.updatedFields.includes(key.toLowerCase());
}

/**
 * Port of C# `TryGet(source, x => x.Field, defaultValue)` — returns the field's value if it was
 * explicitly set, otherwise `defaultValue`.
 */
export function tryGet<T extends IPatchMessage, K extends keyof T & string>(
  source: T,
  key: K,
  defaultValue: T[K],
): T[K] {
  return source.updatedFields.includes(key.toLowerCase()) ? source[key] : defaultValue;
}

/**
 * Port of C# `Set(source, x => x.Field, value)` — assigns `value` to the field and records it as
 * explicitly set (lower-cased, matching C#).
 */
export function set<T extends IPatchMessage, K extends keyof T & string>(source: T, key: K, value: T[K]): void {
  source[key] = value;
  source.updatedFields.push(key.toLowerCase());
}
