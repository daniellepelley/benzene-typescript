import { serviceToken } from '@benzene/abstractions';

/**
 * A tiny example dependency, registered in `StartUp` and injected into `HelloWorldMessageHandler`. It
 * exists to show the shape: a handler depends on an interface, the app registers a real implementation,
 * and a test overrides it (see `test/`). Replace it with your own services (a repository, an HTTP
 * client, ...).
 *
 * The interface keeps the C# `I` prefix and declares a merged `ServiceToken` constant of the same name,
 * per the port's convention for anything resolved from the container — `IGreeter` is both the type you
 * implement and the runtime identifier you register/`inject`.
 */
export interface IGreeter {
  greet(name: string): void;
}

export const IGreeter = serviceToken<IGreeter>('IGreeter');

export class ConsoleGreeter implements IGreeter {
  greet(name: string): void {
    console.log(`Hello ${name}!`);
  }
}
