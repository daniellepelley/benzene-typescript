/** Port of Benzene.Core.MessageHandlers.MessageVersionHeaderNames (+ its registration extensions). */
import {
  IBenzeneServiceContainer,
  IServiceResolver,
  tryAddScopedFactory,
} from '@benzene/abstractions';
import { IMessageVersionGetter } from '@benzene/abstractions-message-handlers';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { HeaderMessageVersionGetter } from './HeaderMessageVersionGetter';

/**
 * An application-wide override for the ordered header-name fallback {@link HeaderMessageVersionGetter}
 * reads the payload schema version from. Register it once via {@link addMessageVersionHeaderNames};
 * every transport's version getter (registered through {@link addHeaderMessageVersionGetter}) then
 * resolves it, so the header names are configured in one place. When it isn't registered, each getter
 * falls back to {@link HeaderMessageVersionGetter.defaultHeaderNames}. Resolved from the container by
 * its own class (the port's `ServiceIdentifier` accepts a constructor, like `JsonSerializer`).
 */
export class MessageVersionHeaderNames {
  constructor(readonly headerNames: readonly string[]) {}
}

/**
 * Overrides, application-wide, the ordered header-name fallback every transport's
 * {@link HeaderMessageVersionGetter} reads the version from. C# extension method -> free function.
 */
export function addMessageVersionHeaderNames(
  services: IBenzeneServiceContainer,
  ...headerNames: string[]
): IBenzeneServiceContainer {
  services.addSingletonFactory(MessageVersionHeaderNames, () => new MessageVersionHeaderNames(headerNames));
  return services;
}

function versionGetterFactory<TContext>(): (resolver: IServiceResolver) => IMessageVersionGetter<unknown> {
  return (resolver) =>
    new HeaderMessageVersionGetter<TContext>(
      resolver.getService(IMessageHeadersGetter) as unknown as IMessageHeadersGetter<TContext>,
      resolver.tryGetService(MessageVersionHeaderNames)?.headerNames,
    ) as unknown as IMessageVersionGetter<unknown>;
}

/**
 * Registers {@link HeaderMessageVersionGetter} as the {@link IMessageVersionGetter}, reading the header
 * names from an application-wide {@link MessageVersionHeaderNames} override when registered and falling
 * back to the defaults otherwise. Transports call this instead of registering the getter directly.
 */
export function addHeaderMessageVersionGetter<TContext>(
  services: IBenzeneServiceContainer,
): IBenzeneServiceContainer {
  services.addScopedFactory(IMessageVersionGetter, versionGetterFactory<TContext>());
  return services;
}

/** The `tryAdd` counterpart of {@link addHeaderMessageVersionGetter}, for conditional registration. */
export function tryAddHeaderMessageVersionGetter<TContext>(
  services: IBenzeneServiceContainer,
): IBenzeneServiceContainer {
  tryAddScopedFactory(services, IMessageVersionGetter, versionGetterFactory<TContext>());
  return services;
}
