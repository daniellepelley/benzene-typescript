/** Port of Benzene.Mesh.Aggregator.MeshAnnotationsMessageHandler. */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { MeshAnnotationRequest, MeshAnnotationThread } from '@benzenejs/mesh-contracts';
import { BenzeneResult } from '@benzenejs/results';
import { MeshAnnotationPublisher } from './MeshAnnotationPublisher';

/**
 * The discussion write endpoint - attaches one note to one entity of the estate and returns that entity's
 * full thread. Reachable on whatever transport the host already runs, the same dogfooded shape as
 * `MeshReportMessageHandler`.
 *
 * Identity is deliberately out of scope: `MeshAnnotationRequest.author` is a self-declared display name, and
 * authenticating who may post is the fronting gateway's job. The handler enforces only shape: required
 * fields and size bounds, so one post can't bloat the artifact every reader downloads. `const` fields ->
 * `static readonly`.
 */
export class MeshAnnotationsMessageHandler implements IMessageHandler<MeshAnnotationRequest, MeshAnnotationThread> {
  /** Maximum accepted length of `MeshAnnotationRequest.entity`. */
  static readonly MaxEntityLength = 200;

  /** Maximum accepted length of `MeshAnnotationRequest.author`. */
  static readonly MaxAuthorLength = 80;

  /** Maximum accepted length of `MeshAnnotationRequest.text`. */
  static readonly MaxTextLength = 4000;

  constructor(private readonly publisher: MeshAnnotationPublisher) {}

  async handleAsync(request: MeshAnnotationRequest): Promise<IBenzeneResultOf<MeshAnnotationThread>> {
    const entity = request?.entity?.trim();
    const author = request?.author?.trim();
    const text = request?.text?.trim();

    if (entity === undefined || entity.length === 0) {
      return BenzeneResult.badRequest<MeshAnnotationThread>('entity is required');
    }
    if (author === undefined || author.length === 0) {
      return BenzeneResult.badRequest<MeshAnnotationThread>('author is required');
    }
    if (text === undefined || text.length === 0) {
      return BenzeneResult.badRequest<MeshAnnotationThread>('text is required');
    }
    if (
      entity.length > MeshAnnotationsMessageHandler.MaxEntityLength ||
      author.length > MeshAnnotationsMessageHandler.MaxAuthorLength ||
      text.length > MeshAnnotationsMessageHandler.MaxTextLength
    ) {
      return BenzeneResult.badRequest<MeshAnnotationThread>(
        `bounds exceeded: entity <= ${MeshAnnotationsMessageHandler.MaxEntityLength}, ` +
          `author <= ${MeshAnnotationsMessageHandler.MaxAuthorLength}, ` +
          `text <= ${MeshAnnotationsMessageHandler.MaxTextLength} characters`,
      );
    }

    const thread = await this.publisher.addAsync(entity, author, text);
    return BenzeneResult.created(thread);
  }
}
