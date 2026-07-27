import { describe, expect, it } from 'vitest';
import { ICurrentTransport } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { addBenzene } from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { InlineAzureFunctionStartUp } from '@benzene/azure-function-core';
import {
  addBlobStorage,
  BlobStorageApplication,
  BlobStorageContext,
  BlobTriggerEvent,
  handleBlob,
  useBlob,
  useBlobStorage,
} from '@benzene/azure-function-blob-storage';

/**
 * End-to-end port of the C# Azure Blob Storage pipeline tests (BlobStoragePipelineTest.cs): wire the
 * full stack via idiomatic DI and feed a blob (name + content) through the Azure Function entry point /
 * `BlobStorageApplication` pipeline. A blob is a file, not a message envelope, so there is no routing —
 * the pipeline is consumed directly with `useBlob(...)`.
 *
 * NOT PORTED: the C# `PlatformNeutralOverload_NoOpsOnNonAzureBuilders` test — the host-neutral
 * `useBlobStorage(IBenzeneApplicationBuilder, ...)` overload is deferred (unported `IBenzeneApplicationBuilder`).
 */

describe('BlobStoragePipeline (via AzureFunctionApp entry point)', () => {
  it('delivers the blob (name + content) to the pipeline', async () => {
    let observed: BlobStorageContext | undefined;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useBlobStorage(builder, (blob) =>
          useBlob(blob, (context) => {
            observed = context;
          }),
        ),
      )
      .build();

    const content = new TextEncoder().encode('some-content');
    await handleBlob(app, 'uploads/invoice-42.json', content);

    expect(observed).toBeDefined();
    expect(observed?.blob.name).toBe('uploads/invoice-42.json');
    expect(observed?.blob.content).toEqual(content);
  });

  it('string overload: encodes UTF-8 and decodes back with getContentAsString', async () => {
    let observed: BlobTriggerEvent | undefined;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useBlobStorage(builder, (blob) =>
          useBlob(blob, (context) => {
            observed = context.blob;
          }),
        ),
      )
      .build();

    await handleBlob(app, 'notes.txt', 'héllo blob');

    expect(observed).toBeDefined();
    expect(observed?.getContentAsString()).toBe('héllo blob');
  });

  it('propagates a pipeline exception so the host retries', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useBlobStorage(builder, (blob) =>
          useBlob(blob, () => {
            throw new Error('handler failed');
          }),
        ),
      )
      .build();

    await expect(handleBlob(app, 'bad.bin', new Uint8Array())).rejects.toThrow('handler failed');
  });
});

describe('BlobStorageApplication (direct)', () => {
  it('runs the blob through the pipeline with the blob-storage transport', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addBlobStorage(container);

    let seenName: string | undefined;
    let seenTransport: string | undefined;
    const pipeline = new MiddlewarePipelineBuilder<BlobStorageContext>(container);
    pipeline.useFn(async (context, next, resolver) => {
      seenName = context.blob.name;
      seenTransport = resolver.getService(ICurrentTransport).name;
      await next();
    });

    const application = new BlobStorageApplication(
      pipeline.build(),
      container.createServiceResolverFactory(),
    );

    await application.sendAsync(new BlobTriggerEvent('report.csv', new TextEncoder().encode('a,b,c')));

    expect(seenName).toBe('report.csv');
    expect(seenTransport).toBe('blob-storage');
  });
});
