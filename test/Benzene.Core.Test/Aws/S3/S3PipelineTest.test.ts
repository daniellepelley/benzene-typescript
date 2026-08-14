import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneException } from '@benzenejs/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { addS3, S3Application, S3RecordContext, useS3 } from '@benzenejs/aws-lambda-s3';
import { benzeneTestHost, type BenzeneStartUp } from '@benzenejs/testing';
import { asS3 } from '@benzenejs/aws-lambda-testing';

/**
 * End-to-end port of the C# S3 pipeline test (test/Benzene.Core.Test/Aws/S3/SnsMessagePipelineTest.cs,
 * class `S3MessagePipelineTest`): wire the full stack via idiomatic DI and feed a realistic S3Event through
 * the Lambda entry point / S3 router / message-handler pipeline. The topic is the S3 event name and the
 * body is the serialized `S3Notification`. S3 is fire-and-forget, so the router writes the `null` "handled"
 * sentinel and the entry point returns it.
 */

class FileUploaded {
  bucketName: string | undefined;
  key: string | undefined;
}

class FileProcessed {
  reference: string | undefined;
}

const handled: { bucket: string | undefined; key: string | undefined }[] = [];
const registry = new MessageHandlersRegistry();

@message('ObjectCreated:Put', { registry, requestType: FileUploaded, responseType: FileProcessed })
class ObjectCreatedHandler implements IMessageHandler<FileUploaded, FileProcessed> {
  handleAsync(request: FileUploaded): Promise<IBenzeneResultOf<FileProcessed>> {
    handled.push({ bucket: request.bucketName, key: request.key });
    const payload = new FileProcessed();
    payload.reference = `${request.bucketName}/${request.key}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

// Migrated off `InlineAwsLambdaStartUp` to the public startup-host harness
// (`benzeneTestHost(StartUp).buildAwsLambdaHost()` + `host.sendEventAsync(...)`) with the `asS3` event
// builder — the exact shape an adopter copies.
class S3StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useS3(aws, (s3) => useMessageHandlers(s3, ObjectCreatedHandler)));
  }
}

describe('S3Pipeline (via the benzeneTestHost harness)', () => {
  it('routes an S3 record to a decorated handler by event name (fire-and-forget)', async () => {
    handled.length = 0;

    const host = benzeneTestHost(S3StartUp).buildAwsLambdaHost();

    const response = await host.sendEventAsync(asS3('my-bucket', 'photos/cat.png'));

    // The handler genuinely ran with the S3Notification body deserialized into its request...
    expect(handled).toEqual([{ bucket: 'my-bucket', key: 'photos/cat.png' }]);
    // ...and S3 is fire-and-forget: the router marks the event handled with the null sentinel.
    expect(response).toBeNull();
  });

  it('throws BenzeneException when no router recognizes the event', async () => {
    const host = benzeneTestHost(S3StartUp).buildAwsLambdaHost();

    await expect(host.sendEventAsync({ foo: 'bar' })).rejects.toThrow(BenzeneException);
  });
});

describe('S3Application (direct)', () => {
  it('runs every record through the pipeline in its own scope, exposing the event name', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addS3(container);

    const seenEventNames: string[] = [];
    const pipeline = new MiddlewarePipelineBuilder<S3RecordContext>(container);
    pipeline.useFn(async (context, next) => {
      seenEventNames.push(context.s3EventNotificationRecord.eventName);
      await next();
    });
    useMessageHandlers(pipeline, ObjectCreatedHandler);

    const application = new S3Application(pipeline.build());
    const event = asS3('b', 'k');

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(seenEventNames).toEqual(['ObjectCreated:Put']);
  });
});
