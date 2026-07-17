import { IBenzeneResult } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { IMessageHandlerDefinition } from './IMessageHandlerDefinition';

/**
 * Routing metadata shared by both the generic and non-generic outcome of dispatching a message to
 * a handler, independent of whether a response payload was produced.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlerResultBase.
 */
export interface IMessageHandlerResultBase {
  /** The topic the message was routed on, or `undefined` if it could not be determined. */
  readonly topic: ITopic | undefined;

  /** The definition of the handler that was invoked, or `undefined` if none was found. */
  readonly messageHandlerDefinition: IMessageHandlerDefinition | undefined;
}

/**
 * The outcome of routing and invoking a handler for one message, produced by a router (e.g.
 * `MessageRouter<TContext>`) and passed to an `IMessageHandlerResultSetter<TContext>` to be written
 * back to the transport.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlerResult.
 *
 * The strongly-typed C# `IMessageHandlerResult<TResponse>` variant is deferred: the routing path
 * (`MessageRouter`) only produces and consumes the untyped form, and TypeScript cannot share the
 * `IMessageHandlerResult` name across arities anyway.
 */
export interface IMessageHandlerResult extends IMessageHandlerResultBase {
  /** The untyped result returned by the handler (or a routing failure, e.g. not-found). */
  readonly benzeneResult: IBenzeneResult;
}
