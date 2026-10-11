/** Port of Benzene.Core.MessageHandlers.MessageVersionHeaderNames (+ its registration extensions). */
import {
  IBenzeneServiceContainer,
  IServiceResolver,
  tryAddScopedFactory,
} from '@benzenejs/abstractions';
import { IMessageVersionGetter } from '@benzenejs/abstractions-message-handlers';
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { HeaderMessageVersionGetter } from './HeaderMessageVersionGetter';

/**
 * An application-wide rename of the one header {@link HeaderMessageVersionGetter} reads the message's
 * version from (default `benzene-version`). Register it once via {@link addMessageVersionHeaderName};
 * every transport's version getter (registered through {@link addHeaderMessageVersionGetter}) resolves
 * it, so the name is configured in one place. Resolved from the container by its own class.
 *
 * DIVERGENCE: .NET's `MessageVersionHeaderNames` holds an ordered fallback list. spec-0.2.0 (D10) made the
 * version header one name — "a configured name replaces the default, it does not join a list" — so the
 * port's type holds exactly one, and is named for it.
 */
export class MessageVersionHeaderName {
  constructor(readonly headerName: string) {}
}

/**
 * Renames, application-wide, the header every transport's {@link HeaderMessageVersionGetter} reads the
 * version from — e.g. `addMessageVersionHeaderName(services, 'schema-version')` for producers that already
 * send that name. C# extension method -> free function.
 */
export function addMessageVersionHeaderName(
  services: IBenzeneServiceContainer,
  headerName: string,
): IBenzeneServiceContainer {
  services.addSingletonFactory(MessageVersionHeaderName, () => new MessageVersionHeaderName(headerName));
  return services;
}

function versionGetterFactory<TContext>(): (resolver: IServiceResolver) => IMessageVersionGetter<unknown> {
  return (resolver) =>
    new HeaderMessageVersionGetter<TContext>(
      resolver.getService(IMessageHeadersGetter) as unknown as IMessageHeadersGetter<TContext>,
      resolver.tryGetService(MessageVersionHeaderName)?.headerName,
    ) as unknown as IMessageVersionGetter<unknown>;
}

/**
 * Registers {@link HeaderMessageVersionGetter} as the {@link IMessageVersionGetter}, reading the header
 * name from an application-wide {@link MessageVersionHeaderName} when registered and `benzene-version`
 * otherwise. Transports call this instead of registering the getter directly.
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
