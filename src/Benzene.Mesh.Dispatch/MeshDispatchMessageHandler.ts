/** Port of Benzene.Mesh.Dispatch.MeshDispatchMessageHandler. */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { RawStringMessage } from '@benzenejs/core-messages';
import { MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import { IMeshServiceDispatcher } from './IMeshServiceDispatcher';
import { MeshDispatchEnvelope } from './MeshDispatchEnvelope';
import { MeshDispatchGate } from './MeshDispatchGate';
import { MeshDispatchRequest } from './MeshDispatchRequest';

/**
 * Serves the `benzene:mesh:dispatch` topic: invokes ONE registered service's real handler with a caller-supplied
 * payload and returns its response. Off unless {@link MeshDispatchGate.isAllowed} (opt-in registration AND
 * non-Production / allowInProduction) - a real handler runs, with real side-effects. Bounded to one
 * declared service, never a shared queue.
 */
export class MeshDispatchMessageHandler implements IMessageHandler<MeshDispatchRequest, RawStringMessage> {
  private readonly dispatchers: IMeshServiceDispatcher[];

  constructor(
    private readonly gate: MeshDispatchGate,
    private readonly registry: MeshServiceRegistry,
    dispatchers: Iterable<IMeshServiceDispatcher>,
  ) {
    this.dispatchers = [...dispatchers];
  }

  async handleAsync(request: MeshDispatchRequest): Promise<IBenzeneResultOf<RawStringMessage>> {
    if (!this.gate.isAllowed) {
      return BenzeneResult.forbidden<RawStringMessage>(this.gate.blockedReason);
    }

    if (
      request === undefined ||
      request === null ||
      (request.service ?? '').trim() === '' ||
      (request.topic ?? '').trim() === ''
    ) {
      return BenzeneResult.badRequest<RawStringMessage>("A dispatch request needs both a 'service' and a 'topic'.");
    }

    const service = request.service!;
    const entry = this.registry.services.find((s) => s.name.toLowerCase() === service.toLowerCase());
    if (entry === undefined) {
      return BenzeneResult.notFound<RawStringMessage>(`No service named '${service}' is registered in the mesh.`);
    }

    const dispatcher = this.dispatchers.find((d) => d.key.toLowerCase() === entry.source.toLowerCase());
    if (dispatcher === undefined) {
      return BenzeneResult.setErrors<RawStringMessage>(
        BenzeneResultStatus.notImplemented,
        `No dispatcher is registered for source '${entry.source}' (service '${entry.name}'). ` +
          'Register the matching transport dispatcher (e.g. addMeshLambdaDispatcher() for AwsLambdaInvoke).',
      );
    }

    const envelope = new MeshDispatchEnvelope(request.topic!, request.headers ?? {}, request.body ?? '');
    const result = await dispatcher.dispatchAsync(entry, envelope);
    const json = JSON.stringify(result);
    return BenzeneResult.ok(new RawStringMessage(json));
  }
}
