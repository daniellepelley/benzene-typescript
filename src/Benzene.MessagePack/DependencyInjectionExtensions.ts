/** Port of Benzene.MessagePack.DependencyInjectionExtensions. */
import { IBenzeneServiceContainer, tryAddSingletonInstance } from '@benzene/abstractions';
import { IMediaFormat } from '@benzene/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { MessagePackMediaFormat } from './MessagePackMediaFormat';
import { MessagePackSerializer } from './MessagePackSerializer';

/**
 * Registration helpers for MessagePack support (C# extension methods → free functions, per the porting
 * conventions).
 * Port of Benzene.MessagePack.DependencyInjectionExtensions.
 *
 * Deviations mirror the {@link addAvro} port: C#'s open-generic `AddMessagePack` and the
 * `AddMessagePack<TContext>` overload collapse into one function (generics are erased, so the
 * `IMediaFormat` / `MessagePackSerializer` tokens are shared across context types). C#
 * `AddSingleton(typeof(IMediaFormat<>), typeof(MessagePackMediaFormat<>))` becomes a singleton factory
 * keyed by the shared `IMediaFormat` token that closes over the built serializer, mirroring how
 * `addMediaFormatNegotiation` registers `JsonMediaFormat` by factory.
 */

/**
 * Registers {@link MessagePackMediaFormat} as an `IMediaFormat<TContext>` plus the shared
 * {@link MessagePackSerializer}.
 * Port of C# `AddMessagePack` / `AddMessagePack<TContext>`.
 */
export function addMessagePack<TContext>(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  const serializer = new MessagePackSerializer();
  tryAddSingletonInstance(services, MessagePackSerializer, serializer);
  services.addSingletonFactory(
    IMediaFormat,
    (_resolver) => new MessagePackMediaFormat<TContext>(serializer) as IMediaFormat<unknown>,
  );
  return services;
}

/**
 * Registers MessagePack support for `TContext` onto a middleware pipeline builder.
 * Port of C# `UseMessagePack<TContext>` (a fluent extension → a free function taking the builder first).
 */
export function useMessagePack<TContext>(
  source: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  source.register((container) => addMessagePack<TContext>(container));
  return source;
}
