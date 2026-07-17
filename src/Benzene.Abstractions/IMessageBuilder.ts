/**
 * Describes a message being built for sending (headers, topic and body).
 * Port of Benzene.Abstractions.IMessageBuilder&lt;T&gt;
 * (C# `IDictionary<string, string>` maps to `Record<string, string>`).
 */
export interface IMessageBuilder<T> {
  readonly headers: Record<string, string>;

  readonly topic: string;

  readonly message: T | undefined;
}
