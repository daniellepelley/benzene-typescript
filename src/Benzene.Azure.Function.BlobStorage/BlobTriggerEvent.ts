/** Port of Benzene.Azure.Function.BlobStorage.BlobTriggerEvent. */

/**
 * Benzene's own model of a blob trigger delivery — dependency-free, mirroring how the .NET package
 * models it (and how `@benzenejs/aws-lambda-kinesis` models its Lambda event). Built from what the
 * isolated-worker `BlobTrigger` hands the function: the blob's content (bind `byte[]`) and its name
 * (bind the `{name}` expression as a `string` parameter).
 *
 * MESSAGE-TYPE ADAPTATION: `@azure/functions` exposes no dedicated blob-trigger payload type — the
 * trigger hands the callback the raw content bytes + the `{name}` binding — so, exactly as in the .NET
 * original, the port keeps a bespoke dependency-free model rather than inventing an SDK dependency. C#
 * `byte[]` maps to `Uint8Array`; `Encoding.UTF8` maps to the built-in `TextDecoder`/`TextEncoder`.
 */
export class BlobTriggerEvent {
  /** The blob's name within the triggering container. */
  readonly name: string;

  /** The blob's content. */
  readonly content: Uint8Array;

  /**
   * @param name The blob's name (the trigger's `{name}` binding expression value).
   * @param content The blob's content.
   */
  constructor(name: string, content: Uint8Array) {
    this.name = name;
    this.content = content;
  }

  /**
   * Decodes {@link content} as a UTF-8 string — for text blobs (JSON, CSV, …). Port of C#
   * `GetContentAsString()` (`Encoding.UTF8.GetString(Content)`).
   *
   * @returns The content as a string.
   */
  getContentAsString(): string {
    return new TextDecoder().decode(this.content);
  }
}
