import { DictionaryUtils as CoreDictionaryUtils } from '@benzene/core';

/**
 * Dictionary merge/enrich helpers used mainly by `EnrichingRequestMapper<TContext>` to fold
 * enricher-supplied values onto an already-mapped request.
 * Port of Benzene.Core.MessageHandlers.Helper.DictionaryUtils (a DIFFERENT type from
 * `@benzene/core`'s `DictionaryUtils`).
 *
 * `mapOnto` is re-exported unchanged from `@benzene/core`'s `DictionaryUtils`: its already-ported
 * `mapOnto` (lower-case keys, only filling missing/undefined/null entries) is behaviourally
 * identical to this C# type's `MapOnto(IDictionary<string, object>, ...)` overload, so it is reused
 * rather than duplicated. Only `enrich` is genuinely new here.
 *
 * Reflection deviation for `enrich`: the C# `Enrich<T>(source, dictionary)` uses reflection to
 * enumerate `T`'s writable public properties and, for each whose name matches (case-insensitively) a
 * dictionary key, sets it (converting the value's type via `Convert.ChangeType`). TypeScript erases
 * `T`, so the port instead enumerates the live `source` object's own-enumerable keys and, for each
 * that matches a dictionary key case-insensitively, assigns the dictionary value. This replicates
 * the two load-bearing C# behaviours exactly: (1) only properties the object already exposes are
 * set — dictionary keys with no matching property are ignored; (2) matching is case-insensitive,
 * with the first key winning on duplicate casings (the C# `TryAdd` semantics). The C#
 * `Convert.ChangeType` step has no erased-type equivalent and is dropped (values are assigned as-is);
 * a `null`/`undefined` `source` is defaulted to `{}` (the port of `Activator.CreateInstance<T>()`).
 */
export const DictionaryUtils = {
  /** Reused from `@benzene/core`; see the type doc comment. Port of C# `MapOnto`. */
  mapOnto: CoreDictionaryUtils.mapOnto,

  /**
   * Applies `dictionary`'s values onto `source`'s own-enumerable properties, matching by key
   * (case-insensitive). Port of C# `Enrich<T>`.
   */
  enrich<T>(source: T, dictionary: Record<string, unknown>): T {
    const entries = Object.entries(dictionary);
    if (entries.length === 0) {
      return source;
    }

    // Build one case-insensitive lookup up front; first key wins on duplicate casings, matching the
    // C# `TryAdd` into an OrdinalIgnoreCase dictionary.
    const caseInsensitiveValues = new Map<string, unknown>();
    for (const [key, value] of entries) {
      const lower = key.toLowerCase();
      if (!caseInsensitiveValues.has(lower)) {
        caseInsensitiveValues.set(lower, value);
      }
    }

    const target = (source ?? ({} as T)) as Record<string, unknown>;

    for (const propertyName of Object.keys(target)) {
      const lower = propertyName.toLowerCase();
      if (caseInsensitiveValues.has(lower)) {
        target[propertyName] = caseInsensitiveValues.get(lower);
      }
    }

    return target as T;
  },
} as const;
