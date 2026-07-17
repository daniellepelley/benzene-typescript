/**
 * Thrown for invalid arguments; MessageHandler maps it to a ValidationError result.
 * Port of the `System.ArgumentException` usage in the .NET original, which has no
 * built-in JavaScript equivalent.
 */
export class ArgumentException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentException';
  }
}
