/** Port of Benzene.HealthChecks.Extensions. */
import { IRegisterDependency } from '@benzene/abstractions';
import {
  IMessageGetter,
  IMessageHandlerResultSetter,
} from '@benzene/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { FuncWrapperMiddleware } from '@benzene/core-middleware';
import { MessageHandlerDefinition, MessageHandlerResult } from '@benzene/core-message-handlers';
import {
  addHealthChecks,
  IHealthCheck,
  IHealthCheckBuilder,
} from '@benzene/health-checks-core';
import { Constants } from './Constants';
import { FailedHealthCheck } from './FailedHealthCheck';
import { HealthCheckBuilder } from './HealthCheckBuilder';
import { HealthCheckProcessor } from './HealthCheckProcessor';

/**
 * Free functions for wiring health checks into a Benzene middleware pipeline. C# `Use*` extension
 * methods on `IMiddlewarePipelineBuilder` become free functions taking the builder as the first
 * argument (the transport-adapter precedent, e.g. `useApiGateway`/`useSqs`).
 *
 * C#'s three `Use*` overloads (a params `IHealthCheck[]`, an `Action<IHealthCheckBuilder>`, or an
 * already-built `IHealthCheckBuilder`) collapse into one `config` parameter, dispatched at runtime:
 * an array is registered as instances, a function configures a fresh builder, and anything else is
 * taken as a ready builder.
 */
export type HealthCheckConfig =
  | IHealthCheck[]
  | ((builder: IHealthCheckBuilder) => void)
  | IHealthCheckBuilder;

function resolveBuilder(
  register: IRegisterDependency,
  config: HealthCheckConfig,
): IHealthCheckBuilder {
  if (Array.isArray(config)) {
    const builder = getHealthCheckerBuilder(register);
    addHealthChecks(builder, ...config);
    return builder;
  }
  if (typeof config === 'function') {
    const builder = getHealthCheckerBuilder(register);
    config(builder);
    return builder;
  }
  return config;
}

/**
 * Adds health check middleware that runs the configured checks whenever an incoming message's topic
 * matches `topic` or `Constants.defaultHealthCheckTopic`; other topics fall through to `next()`.
 */
export function useHealthCheck<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  topic: string,
  config: HealthCheckConfig,
): IMiddlewarePipelineBuilder<TContext> {
  const builder = resolveBuilder(app, config);
  return useHealthCheckMiddleware(app, [topic, Constants.defaultHealthCheckTopic], topic, builder);
}

/**
 * Adds Kubernetes-style liveness-check middleware: runs the configured checks whenever an incoming
 * message's topic matches `Constants.defaultLivenessTopic`. Unlike {@link useHealthCheck}, this does
 * NOT also respond to `Constants.defaultHealthCheckTopic`. A liveness check should verify only that
 * this process itself is responsive - check external dependencies via {@link useReadinessCheck}.
 */
export function useLivenessCheck<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  config: HealthCheckConfig,
): IMiddlewarePipelineBuilder<TContext> {
  const builder = resolveBuilder(app, config);
  return useHealthCheckMiddleware(
    app,
    [Constants.defaultLivenessTopic],
    Constants.defaultLivenessTopic,
    builder,
  );
}

/**
 * Adds Kubernetes-style readiness-check middleware: runs the configured checks whenever an incoming
 * message's topic matches `Constants.defaultReadinessTopic`. This is the right place for checks
 * against external dependencies - a readiness failure only removes the pod from service (no restart).
 */
export function useReadinessCheck<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  config: HealthCheckConfig,
): IMiddlewarePipelineBuilder<TContext> {
  const builder = resolveBuilder(app, config);
  return useHealthCheckMiddleware(
    app,
    [Constants.defaultReadinessTopic],
    Constants.defaultReadinessTopic,
    builder,
  );
}

/**
 * Shared middleware behind every `useHealthCheck`/`useLivenessCheck`/`useReadinessCheck`: runs the
 * builder's checks and sets the aggregated result whenever the incoming message's topic is in
 * `matchTopics`, otherwise passes through to `next()`.
 */
function useHealthCheckMiddleware<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  matchTopics: string[],
  reportedTopic: string,
  builder: IHealthCheckBuilder,
): IMiddlewarePipelineBuilder<TContext> {
  return app.use(
    (resolver) =>
      new FuncWrapperMiddleware<TContext>(
        Constants.healthCheckMiddlewareName,
        async (context, next) => {
          const mapper = resolver.getService(
            IMessageGetter,
          ) as unknown as IMessageGetter<TContext>;
          const resultSetter = resolver.getService(
            IMessageHandlerResultSetter,
          ) as unknown as IMessageHandlerResultSetter<TContext>;

          const messageTopic = mapper.getTopic(context);

          if (messageTopic !== undefined && matchTopics.includes(messageTopic.id)) {
            const result = await HealthCheckProcessor.performHealthChecksAsync(
              reportedTopic,
              builder.getHealthChecks(resolver),
            );
            await resultSetter.setResultAsync(
              context,
              new MessageHandlerResult(messageTopic, MessageHandlerDefinition.empty(), result),
            );
          } else {
            await next();
          }
        },
      ),
  );
}

/** Creates a new `IHealthCheckBuilder` backed by the given dependency registry. */
export function getHealthCheckerBuilder(registerDependency: IRegisterDependency): IHealthCheckBuilder {
  return new HealthCheckBuilder(registerDependency);
}

/**
 * Invokes `func` to construct a health check, catching any error it throws and returning a
 * `FailedHealthCheck` in its place instead of propagating. Use this when the construction of a health
 * check (e.g. its constructor) can itself fail.
 */
export function buildHealthCheck(func: () => IHealthCheck): IHealthCheck {
  try {
    return func();
  } catch (ex) {
    return new FailedHealthCheck(ex);
  }
}
