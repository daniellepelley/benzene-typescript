import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import { ISerializer } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import {
  BatchSend,
  BatchSendResult,
  FailedBatchEntry,
  IBenzeneBatchMessageClient,
  OutboundContext,
} from '@benzene/clients';
import { OutboundEventBridgeContextConverter } from './OutboundEventBridgeContextConverter';
import { awsErrorDetails } from './awsErrorDetails';

/** EventBridge caps a `PutEvents` at 10 entries per call. */
const MAX_BATCH_SIZE = 10;

/** The AWS error code + message for a thrown error, for a {@link FailedBatchEntry}. */
function failure(index: number, error: unknown): FailedBatchEntry {
  const code = awsErrorDetails(error).errorCode;
  const message = error instanceof Error ? error.message : String(error);
  return new FailedBatchEntry(index, code, message);
}

/**
 * Publishes messages to EventBridge using the native `PutEvents` (up to 10 per call) instead of one
 * `PutEvents` per message. Each entry is built by the same {@link OutboundEventBridgeContextConverter} the
 * single-send path uses (so `Source`/`DetailType` and the embedded-headers `Detail` are identical to what
 * `useEventBridge` would send). `PutEvents` responds **positionally** — response entry i corresponds to
 * built entry i — so failures are matched back to the caller's index by position.
 * Port of Benzene.Clients.Aws.EventBridge.EventBridgeBatchMessageClient.
 *
 * PORT DIVERGENCE (matching `useEventBridge`): the `EventBridgeClient` is passed explicitly rather than
 * resolved from the container — see `OutboundEventBridgeContextConverter`.
 */
export class EventBridgeBatchMessageClient implements IBenzeneBatchMessageClient {
  private readonly converter: OutboundEventBridgeContextConverter;

  constructor(
    private readonly amazonEventBridge: EventBridgeClient,
    source: string,
    eventBusName?: string,
    serializer?: ISerializer,
  ) {
    this.converter = new OutboundEventBridgeContextConverter(source, eventBusName, serializer);
  }

  async sendBatchAsync<TRequest>(requests: readonly IBenzeneClientRequest<TRequest>[]): Promise<BatchSendResult> {
    const failures: FailedBatchEntry[] = [];

    for (const chunk of BatchSend.chunk(requests, MAX_BATCH_SIZE)) {
      // Track each built entry with its original request index so the positional response mapping stays
      // correct even when a conversion failure removes an entry from the batch.
      const built: { entry: PutEventsRequestEntry; index: number }[] = [];
      for (const { item, index } of chunk) {
        try {
          const context = await this.converter.createRequestAsync(
            new OutboundContext(item.topic, item.message, item.headers),
          );
          // The converter builds a single-entry request; lift that entry into the batch.
          built.push({ entry: context.request.Entries![0]!, index });
        } catch (error) {
          failures.push(failure(index, error));
        }
      }

      if (built.length === 0) {
        continue;
      }

      try {
        const response = await this.amazonEventBridge.send(
          new PutEventsCommand({ Entries: built.map((b) => b.entry) }),
        );
        // PutEvents responds positionally: response entry i corresponds to built entry i.
        const responseEntries = response.Entries ?? [];
        if ((response.FailedEntryCount ?? 0) > 0) {
          for (let i = 0; i < responseEntries.length && i < built.length; i++) {
            const entry = responseEntries[i]!;
            if (entry.ErrorCode) {
              failures.push(new FailedBatchEntry(built[i]!.index, entry.ErrorCode, entry.ErrorMessage));
            }
          }
        }
      } catch (error) {
        for (const b of built) {
          failures.push(failure(b.index, error));
        }
      }
    }

    return new BatchSendResult(failures);
  }
}
