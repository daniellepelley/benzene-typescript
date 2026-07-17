import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import {
  BenzeneMessageContext,
  IBenzeneMessageRequest,
  IBenzeneMessageResponse,
} from '@benzene/core-messages';
import { MiddlewareApplicationWithResult } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline } from '../Info/TransportMiddlewarePipeline';

/**
 * The application entry point for the transport-agnostic `BenzeneMessage` format: wraps the request
 * pipeline in a `TransportMiddlewarePipeline<BenzeneMessageContext>` tagged with the `"benzene"`
 * transport name, converts an incoming `IBenzeneMessageRequest` into a `BenzeneMessageContext`, and
 * returns the resulting `IBenzeneMessageResponse`.
 * Port of Benzene.Core.MessageHandlers.BenzeneMessage.BenzeneMessageApplication.
 *
 * C# `MiddlewareApplication<TEvent, TContext, TResult>` (the arity-3, result-returning variant) maps
 * to the port's `MiddlewareApplicationWithResult<TEvent, TContext, TResult>`, per the porting
 * conventions' `WithResult` suffix rule.
 *
 * Use this to invoke a Benzene pipeline directly with an in-process/programmatic message rather than
 * through a specific network transport, e.g. from tests or from another adapter that already has an
 * `IBenzeneMessageRequest`.
 */
export class BenzeneMessageApplication extends MiddlewareApplicationWithResult<
  IBenzeneMessageRequest,
  BenzeneMessageContext,
  IBenzeneMessageResponse
> {
  constructor(pipeline: IMiddlewarePipeline<BenzeneMessageContext>) {
    super(
      new TransportMiddlewarePipeline<BenzeneMessageContext>('benzene', pipeline),
      (event) => new BenzeneMessageContext(event),
      (context) => context.benzeneMessageResponse,
    );
  }
}
