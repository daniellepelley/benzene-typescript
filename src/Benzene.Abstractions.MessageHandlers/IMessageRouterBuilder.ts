import { IRegisterDependency } from '@benzene/abstractions';
import { IHandlerMiddlewareBuilder } from './IHandlerMiddlewareBuilder';

/**
 * Startup-time configuration surface for message routing: application code registers
 * `IHandlerMiddlewareBuilder`s here so an `IHandlerPipelineBuilder` can later include them in every
 * handler pipeline it builds. Also inherits `IRegisterDependency` so DI registrations can be added
 * alongside middleware registration in the same configuration step.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageRouterBuilder.
 */
export interface IMessageRouterBuilder extends IRegisterDependency {
  /**
   * Registers a handler middleware builder to be included in future handler pipelines.
   * Port of C# `Add(IHandlerMiddlewareBuilder)`; returns this builder for fluent chaining.
   */
  add(handlerMiddlewareBuilder: IHandlerMiddlewareBuilder): IMessageRouterBuilder;

  /** Returns every handler middleware builder registered so far. Port of C# `GetBuilders()`. */
  getBuilders(): IHandlerMiddlewareBuilder[];
}
