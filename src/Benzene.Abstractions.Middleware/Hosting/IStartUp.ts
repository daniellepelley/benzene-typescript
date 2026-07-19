/**
 * Port of Benzene.Abstractions.Hosting.IStartUp&lt;TContainer, TConfiguration, TAppBuilder&gt;.
 *
 * The startup contract a host drives to configure services and the application pipeline. `void` return
 * types stay `void`; the methods are synchronous in the C# original and remain so here.
 */
export interface IStartUp<TContainer, TConfiguration, TAppBuilder> {
  /** Produces the configuration object the host passes back into the other two methods. */
  getConfiguration(): TConfiguration;

  /** Registers services with the container. */
  configureServices(services: TContainer, configuration: TConfiguration): void;

  /** Configures the application/middleware pipeline. */
  configure(app: TAppBuilder, configuration: TConfiguration): void;
}
