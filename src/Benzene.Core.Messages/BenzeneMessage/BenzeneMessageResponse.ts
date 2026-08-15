import { IBenzeneMessageResponse } from './IBenzeneMessageResponse';

/**
 * Default `IBenzeneMessageResponse` implementation.
 * Port of Benzene.Core.Messages.BenzeneMessage.BenzeneMessageResponse.
 *
 * As in C#, a freshly-constructed response has none of its members set yet (they are non-null-typed
 * but unassigned until the pipeline writes them); the port models this with definite-assignment
 * (`!`) fields. `ensureResponseExists` fills in `headers` before the first header write.
 *
 * `isSuccessful` is the exception: it carries an explicit `false` initializer rather than a
 * definite-assignment field, mirroring C#'s `bool` default. It is a **required** envelope member
 * (wire-contracts.md §1.2), and an unassigned TypeScript field is `undefined` — which `JSON.stringify`
 * drops entirely, silently emitting an envelope with no `isSuccessful` at all.
 */
export class BenzeneMessageResponse implements IBenzeneMessageResponse {
  statusCode!: string;
  isSuccessful = false;
  headers!: Record<string, string>;
  body!: string;
}
