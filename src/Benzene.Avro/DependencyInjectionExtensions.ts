/** Port of Benzene.Avro.DependencyInjectionExtensions. */
import { IBenzeneServiceContainer, tryAddSingletonInstance } from '@benzene/abstractions';
import { IMediaFormat } from '@benzene/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { AvroMediaFormat } from './AvroMediaFormat';
import { AvroOptions } from './AvroOptions';
import { AvroSchemaResolver } from './AvroSchemaResolver';
import { AvroSerializer } from './AvroSerializer';

/**
 * Registration helpers for Avro support (C# extension methods → free functions, per the porting
 * conventions). Avro is schema-based, so `configure` lets you register explicit schemas per message
 * class via {@link AvroOptions}; unlike .NET there is no reflection fallback, so every serialized type
 * must be registered (here or on the global `AvroSchemaRegistry`).
 * Port of Benzene.Avro.DependencyInjectionExtensions.
 *
 * Deviations: C#'s open-generic `AddAvro` and the `AddAvro<TContext>` overload collapse into one
 * function (generics are erased, so the `IMediaFormat`/`AvroSerializer` tokens are shared across
 * context types). C# `AddSingleton(typeof(IMediaFormat<>), typeof(AvroMediaFormat<>))` becomes a
 * singleton factory keyed by the shared `IMediaFormat` token that closes over the built serializer,
 * mirroring how `addMediaFormatNegotiation` registers `JsonMediaFormat` by factory.
 */
function buildSerializer(configure?: (options: AvroOptions) => void): AvroSerializer {
  const options = new AvroOptions();
  configure?.(options);
  return new AvroSerializer(new AvroSchemaResolver(options));
}

/**
 * Registers {@link AvroMediaFormat} as an `IMediaFormat<TContext>` plus the shared {@link AvroSerializer}.
 * Port of C# `AddAvro` / `AddAvro<TContext>`.
 */
export function addAvro<TContext>(
  services: IBenzeneServiceContainer,
  configure?: (options: AvroOptions) => void,
): IBenzeneServiceContainer {
  const serializer = buildSerializer(configure);
  tryAddSingletonInstance(services, AvroSerializer, serializer);
  services.addSingletonFactory(
    IMediaFormat,
    (_resolver) => new AvroMediaFormat<TContext>(serializer) as IMediaFormat<unknown>,
  );
  return services;
}

/** Alias for {@link addAvro}, matching the task's `addAvroMediaFormat` name. */
export const addAvroMediaFormat = addAvro;

/**
 * Registers Avro support for `TContext` onto a middleware pipeline builder.
 * Port of C# `UseAvro<TContext>` (a fluent extension → a free function taking the builder first).
 */
export function useAvro<TContext>(
  source: IMiddlewarePipelineBuilder<TContext>,
  configure?: (options: AvroOptions) => void,
): IMiddlewarePipelineBuilder<TContext> {
  source.register((container) => addAvro<TContext>(container, configure));
  return source;
}
