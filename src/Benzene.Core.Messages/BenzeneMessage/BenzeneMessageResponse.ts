import { IBenzeneMessageResponse } from './IBenzeneMessageResponse';

/**
 * Default `IBenzeneMessageResponse` implementation.
 * Port of Benzene.Core.Messages.BenzeneMessage.BenzeneMessageResponse.
 *
 * As in C#, a freshly-constructed response has none of its members set yet (they are non-null-typed
 * but unassigned until the pipeline writes them); the port models this with definite-assignment
 * (`!`) fields. `ensureResponseExists` fills in `headers` before the first header write.
 */
export class BenzeneMessageResponse implements IBenzeneMessageResponse {
  statusCode!: string;
  headers!: Record<string, string>;
  body!: string;
}
