/**
 * Well-known validation constraint names.
 * Port of Benzene.Abstractions.Validation.ValidationConstants (a C# static class of `const string`s
 * becomes a frozen object of string literals).
 */
export const ValidationConstants = {
  minLength: 'MinLength',
  maxLength: 'MaxLength',
  isGuid: 'IsGuid',
  isNumeric: 'IsNumeric',
  notEmpty: 'NotEmpty',
  notNull: 'NotNull',
  isOneOf: 'IsOneOf',
  regex: 'Regex',
  email: 'Email',
  phone: 'Phone',
  isDoubleGuid: 'IsDoubleGuid',
  isLettersOrSymbols: 'IsLettersOrSymbols',
  isNumbersOrSymbols: 'IsNumbersOrSymbols',
  isAlphaNumericOrSymbols: 'IsAlphaNumericOrSymbols',
  isBoolean: 'IsBoolean',
  greaterThanOrEqual: 'GreaterThanOrEqual',
  lessThanOrEqual: 'LessThanOrEqual',
  greaterThan: 'GreaterThan',
  lessThan: 'LessThan',
  notEqual: 'NotEqual',
} as const;
