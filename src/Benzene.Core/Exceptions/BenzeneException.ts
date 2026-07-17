/**
 * Base error type thrown by Benzene components.
 * Port of Benzene.Core.Exceptions.BenzeneException
 * (C# `Exception.InnerException` maps to the standard `Error.cause`).
 */
export class BenzeneException extends Error {
  constructor(message: string, innerException?: unknown) {
    super(message, innerException === undefined ? undefined : { cause: innerException });
    this.name = 'BenzeneException';
  }
}
