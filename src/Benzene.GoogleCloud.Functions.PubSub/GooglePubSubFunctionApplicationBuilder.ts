/** Port of Benzene.GoogleCloud.Functions.PubSub.GooglePubSubFunctionApplicationBuilder. */
import { IBenzeneServiceContainer, IServiceResolverFactory } from '@benzene/abstractions';
import { IEntryPointMiddlewareApplication } from '@benzene/abstractions-middleware';
import { BenzeneApplicationBuilder } from '@benzene/core-middleware';
import { MessagePublishedData } from './MessagePublishedData';

/**
 * The builder a startup's `configure` is run against when hosted on Google Cloud Functions via
 * {@link GooglePubSubFunctionHost}.
 *
 * Mirrors `GoogleCloudFunctionApplicationBuilder`'s deferred-build shape, but is self-contained rather
 * than reusing an existing HTTP-shaped adapter: unlike the HTTP trigger (which piggybacks on
 * `@benzene/express`), a Pub/Sub CloudEvent trigger has no existing Benzene builder abstraction to
 * reuse, so `usePubSub` recognizes this builder directly. {@link add} stores the entry point application
 * factory and {@link build} invokes it once {@link GooglePubSubFunctionHost} has the final resolver
 * factory.
 */
export class GooglePubSubFunctionApplicationBuilder extends BenzeneApplicationBuilder {
  /** The platform identifier reported by the base `IBenzeneApplicationBuilder.platform`. */
  static readonly platformName = 'GoogleCloudFunctions';

  private appFactory?: (
    serviceResolverFactory: IServiceResolverFactory,
  ) => IEntryPointMiddlewareApplication<MessagePublishedData>;

  /**
   * @param benzeneServiceContainer The service container backing this builder.
   */
  constructor(benzeneServiceContainer: IBenzeneServiceContainer) {
    super(GooglePubSubFunctionApplicationBuilder.platformName, benzeneServiceContainer);
  }

  /**
   * Stores the entry point application factory registered by `usePubSub(...)`, deferring construction
   * until {@link build} is called with the final resolver factory. Port of C# `Add`.
   *
   * @param func A factory that creates the entry point application given the current resolver factory.
   */
  add(
    func: (
      serviceResolverFactory: IServiceResolverFactory,
    ) => IEntryPointMiddlewareApplication<MessagePublishedData>,
  ): void {
    this.appFactory = func;
  }

  /**
   * Invokes the factory stored by {@link add} to build the entry point application that handles every
   * incoming Pub/Sub message. Port of C# `Build`.
   *
   * @param serviceResolverFactory The fully-configured service resolver factory to build the application with.
   * @throws {Error} No Pub/Sub pipeline was configured — the startup's `configure` must call `usePubSub(...)`.
   */
  build(
    serviceResolverFactory: IServiceResolverFactory,
  ): IEntryPointMiddlewareApplication<MessagePublishedData> {
    if (this.appFactory === undefined) {
      throw new Error(
        'No Pub/Sub pipeline configured - call usePubSub(...) in your BenzeneStartUp.configure implementation.',
      );
    }

    return this.appFactory(serviceResolverFactory);
  }
}
