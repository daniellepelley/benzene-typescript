import { describe, expect, it } from 'vitest';
import { Context, S3Event, S3EventRecord } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult } from '@benzene/results';
import { BenzeneException } from '@benzene/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import { addS3, S3Application, S3RecordContext, useS3 } from '@benzene/aws-lambda-s3';

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

function createS3Record(eventName: string, bucket: string, key: string): S3EventRecord {
  return {
    eventVersion: '2.1',
    eventSource: 'aws:s3',
    awsRegion: 'us-east-1',
    eventTime: '1970-01-01T00:00:00.000Z',
    eventName,
    userIdentity: { principalId: 'principal' },
    requestParameters: { sourceIPAddress: '127.0.0.1' },
    responseElements: { 'x-amz-request-id': 'req', 'x-amz-id-2': 'id2' },
    s3: {
      s3SchemaVersion: '1.0',
      configurationId: 'config',
      bucket: {
        name: bucket,
        ownerIdentity: { principalId: 'owner' },
        arn: `arn:aws:s3:::${bucket}`,
      },
      object: {
        key,
        size: 1024,
        eTag: 'etag',
        sequencer: '0A1B2C3D4E5F678901',
      },
    },
  };
}

function createS3Event(
  records: { eventName: string; bucket: string; key: string }[],
): S3Event {
  return { Records: records.map((r) => createS3Record(r.eventName, r.bucket, r.key)) };
}

const fakeLambdaContext = {} as Context;

describe('S3Pipeline (via AwsLambdaEntryPoint)', () => {
  it('routes an S3 record to a decorated handler by event name (fire-and-forget)', async () => {
    handled.length = 0;

    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useS3(app, (s3) => useMessageHandlers(s3, ObjectCreatedHandler)))
      .build();

    const event = createS3Event([
      { eventName: 'ObjectCreated:Put', bucket: 'my-bucket', key: 'photos/cat.png' },
    ]);

    const response = await entryPoint.functionHandlerAsync(event, fakeLambdaContext);

    // The handler genuinely ran with the S3Notification body deserialized into its request...
    expect(handled).toEqual([{ bucket: 'my-bucket', key: 'photos/cat.png' }]);
    // ...and S3 is fire-and-forget: the router marks the event handled with the null sentinel.
    expect(response).toBeNull();
  });

  it('throws BenzeneException when no router recognizes the event', async () => {
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useS3(app, (s3) => useMessageHandlers(s3, ObjectCreatedHandler)))
      .build();

    await expect(entryPoint.functionHandlerAsync({ foo: 'bar' }, fakeLambdaContext)).rejects.toThrow(
      BenzeneException,
    );
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
    const event = createS3Event([
      { eventName: 'ObjectCreated:Put', bucket: 'b', key: 'k' },
    ]);

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(seenEventNames).toEqual(['ObjectCreated:Put']);
  });
});
