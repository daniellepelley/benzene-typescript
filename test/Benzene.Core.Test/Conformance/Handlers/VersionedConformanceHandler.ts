import { IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { conformanceRegistry } from './GreetConformanceHandler';

export class VersionedReply {
  version = '';
}

/**
 * Canonical conformance handler `conformance:versioned` at version `v1`, **declared the topic's default**
 * (see docs/specification/conformance/README.md): returns `{ "version": "v1" }`. Exercises version
 * selection (core-concepts §2): exact match, absent version → default, unknown version → not-found.
 */
@message('conformance:versioned', {
  registry: conformanceRegistry,
  version: 'v1',
  isDefault: true,
  requestType: VoidResult,
  responseType: VersionedReply,
})
export class VersionedV1ConformanceHandler implements IMessageHandler<VoidResult, VersionedReply> {
  handleAsync(): Promise<IBenzeneResultOf<VersionedReply>> {
    return Promise.resolve(BenzeneResult.ok<VersionedReply>({ version: 'v1' }));
  }
}

/** Canonical conformance handler `conformance:versioned` at version `v2`: returns `{ "version": "v2" }`. */
@message('conformance:versioned', {
  registry: conformanceRegistry,
  version: 'v2',
  requestType: VoidResult,
  responseType: VersionedReply,
})
export class VersionedV2ConformanceHandler implements IMessageHandler<VoidResult, VersionedReply> {
  handleAsync(): Promise<IBenzeneResultOf<VersionedReply>> {
    return Promise.resolve(BenzeneResult.ok<VersionedReply>({ version: 'v2' }));
  }
}
