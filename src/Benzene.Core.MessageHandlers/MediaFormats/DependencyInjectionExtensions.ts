import { IBenzeneServiceContainer, tryAddScopedFactory } from '@benzene/abstractions';
import { IMediaFormat, IMediaFormatNegotiator } from '@benzene/abstractions-message-handlers';
import { JsonSerializer } from '../Serialization/JsonSerializer';
import { JsonMediaFormat } from './JsonMediaFormat';
import { MediaFormatNegotiator } from './MediaFormatNegotiator';

/**
 * Shared content-negotiation registration, called by every transport that maps requests and/or
 * writes responses, so an `IMediaFormatNegotiator<TContext>` is always available wherever an
 * `IMediaFormat<TContext>` might be registered for that context type.
 * Port of Benzene.Core.MessageHandlers.MediaFormats.DependencyInjectionExtensions
 * (C# extension methods become free functions).
 *
 * Deviations: C# `services.TryAddScoped<JsonMediaFormat<TContext>>()` relies on reflective
 * constructor injection to supply the `JsonSerializer`; the port has no static-inject convention, so
 * both registrations use explicit scoped factories instead. `IEnumerable<IMediaFormat<TContext>>`
 * becomes `resolver.getServices(IMediaFormat)`. `TContext` is a phantom type parameter kept for
 * signature parity (generics are erased, so the tokens are shared across context types, matching the
 * existing porting precedent).
 */
export function addMediaFormatNegotiation<TContext>(
  services: IBenzeneServiceContainer,
): IBenzeneServiceContainer {
  tryAddScopedFactory(
    services,
    JsonMediaFormat,
    (resolver) => new JsonMediaFormat<TContext>(resolver.getService(JsonSerializer)),
  );
  tryAddScopedFactory(
    services,
    IMediaFormatNegotiator,
    (resolver) =>
      new MediaFormatNegotiator<TContext>(
        resolver.getServices(IMediaFormat) as IMediaFormat<TContext>[],
        resolver.getService(JsonMediaFormat) as JsonMediaFormat<TContext>,
        resolver,
      ) as IMediaFormatNegotiator<unknown>,
  );
  return services;
}
