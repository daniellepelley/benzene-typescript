/** Port of Benzene.Xml.DependencyInjectionExtensions. */
import { IBenzeneServiceContainer, tryAddSingletonInstance } from '@benzene/abstractions';
import { IMediaFormat } from '@benzene/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { XmlMediaFormat } from './XmlMediaFormat';
import { XmlSerializer } from './XmlSerializer';

/**
 * Registration helpers for XML support (C# extension methods → free functions, per the porting
 * conventions).
 * Port of Benzene.Xml.DependencyInjectionExtensions.
 *
 * Deviations mirror the {@link addAvro} / `addMessagePack` ports: C#'s open-generic `AddXml` and the
 * `AddXml<TContext>` overload collapse into one function (generics are erased, so the `IMediaFormat` /
 * `XmlSerializer` tokens are shared across context types). C#
 * `AddSingleton(typeof(IMediaFormat<>), typeof(XmlMediaFormat<>))` becomes a singleton factory keyed by
 * the shared `IMediaFormat` token that closes over the built serializer, mirroring how
 * `addMediaFormatNegotiation` registers `JsonMediaFormat` by factory.
 */

/**
 * Registers {@link XmlMediaFormat} as an `IMediaFormat<TContext>` plus the shared {@link XmlSerializer}.
 * Port of C# `AddXml` / `AddXml<TContext>`.
 */
export function addXml<TContext>(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  const serializer = new XmlSerializer();
  tryAddSingletonInstance(services, XmlSerializer, serializer);
  services.addSingletonFactory(
    IMediaFormat,
    (_resolver) => new XmlMediaFormat<TContext>(serializer) as IMediaFormat<unknown>,
  );
  return services;
}

/**
 * Registers XML support for `TContext` onto a middleware pipeline builder.
 * Port of C# `UseXml<TContext>` (a fluent extension → a free function taking the builder first).
 */
export function useXml<TContext>(
  source: IMiddlewarePipelineBuilder<TContext>,
): IMiddlewarePipelineBuilder<TContext> {
  source.register((container) => addXml<TContext>(container));
  return source;
}
