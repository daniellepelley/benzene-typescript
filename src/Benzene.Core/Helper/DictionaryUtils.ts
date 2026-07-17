/**
 * Dictionary helpers used across Benzene packages.
 * Port of Benzene.Core.Helper.DictionaryUtils
 * (C# `IDictionary<string, T>` maps to `Record<string, T>`).
 */
export const DictionaryUtils = {
  /**
   * Overlays entries onto `source` (lower-cased keys), only filling keys that are
   * missing or unset. Port of C# `MapOnto`.
   */
  mapOnto<TValue>(
    source: Record<string, TValue>,
    overlayDictionary: Record<string, TValue> | undefined | null,
  ): Record<string, TValue> {
    if (!overlayDictionary) {
      return source;
    }

    for (const [key, value] of Object.entries(overlayDictionary)) {
      const lowerKey = key.toLowerCase();
      if (!(lowerKey in source) || source[lowerKey] === undefined || source[lowerKey] === null) {
        source[lowerKey] = value;
      }
    }

    return source;
  },

  /** Combines dictionaries, keeping the first value seen for each key. Port of C# `Combine`. */
  combine<TValue>(source: Iterable<Record<string, TValue>>): Record<string, TValue> {
    const output: Record<string, TValue> = {};

    for (const dictionary of source) {
      for (const [key, value] of Object.entries(dictionary)) {
        if (!(key in output)) {
          output[key] = value;
        }
      }
    }

    return output;
  },

  /**
   * Keeps only entries whose lower-cased key appears in `filter`, renaming them to
   * the filter's mapped name. Port of C# `FilterAndReplace`.
   */
  filterAndReplace(
    source: Record<string, string>,
    filter: Record<string, string>,
  ): Record<string, string> {
    const output: Record<string, string> = {};

    for (const [key, value] of Object.entries(source)) {
      const replacement = filter[key.toLowerCase()];
      if (replacement !== undefined && !(replacement in output)) {
        output[replacement] = value;
      }
    }

    return output;
  },

  /**
   * Renames entries whose lower-cased key appears in `filter`, keeping others as-is.
   * Port of C# `Replace`.
   */
  replace(source: Record<string, string>, filter: Record<string, string>): Record<string, string> {
    const output: Record<string, string> = {};

    for (const [key, value] of Object.entries(source)) {
      const replacement = filter[key.toLowerCase()] !== undefined ? filter[key.toLowerCase()] : key;
      if (!(replacement in output)) {
        output[replacement] = value;
      }
    }

    return output;
  },

  /** Port of C# `Set`. */
  set(dictionary: Record<string, string>, key: string, value: string): void {
    dictionary[key] = value;
  },

  /** Case-sensitive key/value check. Port of C# `KeyEquals`. */
  keyEquals(dictionary: Record<string, string>, key: string, value: string): boolean {
    return dictionary[key] === value;
  },
} as const;
