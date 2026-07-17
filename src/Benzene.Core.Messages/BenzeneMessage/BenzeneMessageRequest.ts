import { IBenzeneMessageRequest } from './IBenzeneMessageRequest';

/**
 * Default `IBenzeneMessageRequest` implementation.
 * Port of Benzene.Core.Messages.BenzeneMessage.BenzeneMessageRequest.
 *
 * The C# auto-properties are set via object-initializer syntax with no constructor; the port keeps
 * the same shape using definite-assignment (`!`) fields, so callers populate `topic`/`headers`/`body`
 * after construction exactly as the C# object initializer does.
 */
export class BenzeneMessageRequest implements IBenzeneMessageRequest {
  topic!: string;
  headers!: Record<string, string>;
  body!: string;
}
