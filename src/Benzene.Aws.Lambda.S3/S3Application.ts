/** Port of Benzene.Aws.Lambda.S3.S3Application. */
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { MiddlewareMultiApplication } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { S3Event } from 'aws-lambda';
import { S3RecordContext } from './S3RecordContext';

/**
 * Processes an S3 event notification batch by mapping each record to an `S3RecordContext` and running them
 * all through the middleware pipeline concurrently (each in its own DI scope), tagging the transport as
 * `"s3"` for the duration.
 *
 * Faithful to .NET: C# `S3Application : MiddlewareMultiApplication<S3Event, S3RecordContext>` (the arity-2,
 * fire-and-forget, no-response variant) maps to the ported `MiddlewareMultiApplication<S3Event,
 * S3RecordContext>`. The base constructor takes the `TransportMiddlewarePipeline("s3", pipeline)` wrapper
 * (which resolves `ISetCurrentTransport` and calls `setTransport("s3")` before delegating) and a mapper
 * from the event to one context per record. `event.Records` stays PascalCase in `@types/aws-lambda`.
 */
export class S3Application extends MiddlewareMultiApplication<S3Event, S3RecordContext> {
  constructor(pipeline: IMiddlewarePipeline<S3RecordContext>) {
    super(
      new TransportMiddlewarePipeline<S3RecordContext>('s3', pipeline),
      (event) => event.Records.map((record) => S3RecordContext.createInstance(event, record)),
    );
  }
}
