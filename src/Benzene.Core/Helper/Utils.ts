/**
 * Port of Benzene.Core.Helper.Utils.
 *
 * Only `getValue` is ported: the C# `GetAllTypes`/`GetAssemblies` helpers scan
 * loaded assemblies via reflection, which has no JavaScript equivalent. Their
 * consumers (e.g. reflection-based message-handler discovery) will use explicit
 * registration in the TypeScript port instead.
 */

/** Safe dictionary lookup returning `undefined` when absent. Port of C# `GetValue`. */
export function getValue(
  dictionary: Record<string, string> | undefined | null,
  key: string,
): string | undefined {
  return dictionary ? dictionary[key] : undefined;
}
