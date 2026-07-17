/**
 * TypeScript-only file with no C# counterpart.
 *
 * The .NET version of Benzene resolves services by runtime `Type`
 * (e.g. `GetService<IMiddlewareFactory>()`). TypeScript erases types at
 * runtime, so interfaces need a runtime stand-in. Each ported interface
 * declares a `ServiceToken` constant with the same name as the interface
 * (declaration merging), so call sites still read like the C# original:
 *
 *     resolver.getService(IMiddlewareFactory)
 *
 * Classes can be used directly as their own identifier, mirroring
 * `typeof(MyMiddleware)` in C#.
 */
export class ServiceToken<T> {
  declare readonly __serviceType: T;

  constructor(public readonly description: string) {}

  toString(): string {
    return this.description;
  }
}

/** Creates a runtime token representing a ported C# interface or generic type. */
export function serviceToken<T>(description: string): ServiceToken<T> {
  return new ServiceToken<T>(description);
}

/** A concrete class constructor usable both as a service identifier and as an implementation. */
export type Constructor<T> = new (...args: never[]) => T;

/**
 * The TypeScript equivalent of a C# `Type`/generic type parameter used for service
 * resolution: either a `ServiceToken` (for interfaces) or a class constructor.
 */
export type ServiceIdentifier<T> = ServiceToken<T> | Constructor<T>;

/** Returns a display name for a service identifier, used in error messages. */
export function serviceIdentifierName(identifier: ServiceIdentifier<unknown>): string {
  return identifier instanceof ServiceToken ? identifier.description : identifier.name;
}

/**
 * Implementation classes may declare a static `inject` array of service
 * identifiers; the container resolves them and passes them to the constructor
 * in order. This is the port of C# constructor injection, which relies on
 * reflection that TypeScript does not have.
 */
export interface InjectableConstructor<T> {
  new (...args: never[]): T;
  readonly inject?: readonly ServiceIdentifier<unknown>[];
}
