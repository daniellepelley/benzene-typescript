/**
 * The outbound request an `IBenzeneClientContext` carries: its target topic, the message payload and
 * any headers to forward.
 * Port of Benzene.Abstractions.Messages.BenzeneClient.IBenzeneClientRequest&lt;TMessage&gt;.
 */
export interface IBenzeneClientRequest<TMessage> {
  /** Port of C# `string Topic { get; }`. */
  readonly topic: string;

  /** Port of C# `TMessage Message { get; }`. */
  readonly message: TMessage;

  /** Port of C# `IDictionary<string, string> Headers { get; }`. */
  readonly headers: Record<string, string>;
}
