import { IRegisterDependency } from '@benzene/abstractions';
import { IMessageSenderBuilder } from './IMessageSenderBuilder';
import { MessageSenderBuilder } from './MessageSenderBuilder';

/**
 * Registers outbound senders on a dependency registration by handing a `MessageSenderBuilder` to the
 * caller.
 * Port of Benzene.Core.Messages.MessageSender.MessageSenderExtensions (a non-fluent C# extension →
 * free function taking the `IRegisterDependency` as its first argument). C# `Out` is a reserved-ish
 * but valid TypeScript identifier; kept as `out`.
 */
export function out(
  source: IRegisterDependency,
  action: (builder: IMessageSenderBuilder) => void,
): IRegisterDependency {
  const messageSenderBuilder = new MessageSenderBuilder(source);
  action(messageSenderBuilder);
  return source;
}
