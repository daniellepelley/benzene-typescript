/** Port of Benzene.Testing.MessageBuilder. */
import { IMessageBuilder } from '@benzenejs/abstractions';

/**
 * A fluent builder for a Benzene message (topic + typed body + headers) to drive through a test, and
 * the input the transport `as*` builders (`@benzenejs/aws-lambda-testing`, …) turn into a native cloud
 * event. Port of `Benzene.Testing.MessageBuilder<T>`; the C# static `MessageBuilder.Create` factory
 * becomes the free function {@link messageBuilder} (the TypeScript-idiomatic entry point).
 */
export class MessageBuilder<T> implements IMessageBuilder<T> {
  readonly headers: Record<string, string> = {};

  constructor(
    readonly topic: string,
    readonly message: T | undefined,
  ) {}

  /** Sets a header (last-wins, like a real header map). */
  withHeader(key: string, value: string): this {
    this.headers[key] = value;
    return this;
  }

  /** Merges headers in (additive, last-wins). */
  withHeaders(headers: Record<string, string>): this {
    for (const [key, value] of Object.entries(headers)) {
      this.headers[key] = value;
    }
    return this;
  }
}

/** Builds a message with no body (topic only). */
export function messageBuilder(topic: string): MessageBuilder<object>;
/** Builds a message with a typed body. */
export function messageBuilder<T>(topic: string, message: T): MessageBuilder<T>;
export function messageBuilder<T>(topic: string, message?: T): MessageBuilder<T | object> {
  return new MessageBuilder<T | object>(topic, message);
}
