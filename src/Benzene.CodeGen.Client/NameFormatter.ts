/**
 * Port of the name-formatting rules in Benzene.CodeGen.Core (`FormatString` + `CodeGenHelpers`):
 * the deterministic identifier hygiene the generators apply to topic segments and property names.
 * C# `struct FormatString` + extension methods -> plain free functions.
 */

/** Uppercases the first character only (the C# `Pascalcase`, which does not lowercase the remainder). */
export function pascalCase(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/** Lowercases the first character only - TypeScript methods are camelCase (`HandleAsync` -> `handleAsync`). */
export function camelCase(value: string): string {
  return value.length === 0 ? value : value[0]!.toLowerCase() + value.slice(1);
}

/** Keeps only identifier characters (letters, digits, `_`) - the C# `RemoveNonIdentifierCharacters`. */
export function removeNonIdentifierCharacters(value: string): string {
  return [...value].filter((ch) => /[A-Za-z0-9_]/.test(ch)).join('');
}

/** Prefixes `_` when the first character is neither a letter nor `_` - the C# `EnsureStartsWithLetterOrUnderScore`. */
export function ensureStartsWithLetterOrUnderscore(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return /[A-Za-z_]/.test(value[0]!) ? value : `_${value}`;
}

/** `RemoveNonIdentifierCharacters().Pascalcase().EnsureStartsWithLetterOrUnderScore()`, in that order. */
export function toIdentifierSegment(value: string): string {
  return ensureStartsWithLetterOrUnderscore(pascalCase(removeNonIdentifierCharacters(value)));
}

/** True when `name` is a bare TypeScript property identifier (so it needs no quoting in an object type). */
export function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}
