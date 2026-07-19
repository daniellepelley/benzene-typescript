/** Port of Benzene.Extras.Results.Base64JsonMessage. */
import { IBase64JsonMessage } from '@benzene/abstractions';

/** A concrete {@link IBase64JsonMessage} carrying a Base64-encoded JSON string. */
export class Base64JsonMessage implements IBase64JsonMessage {
  private constructor(readonly base64Json: string) {}

  /** Port of C# `Base64JsonMessage.CreateInstance` (the private ctor stays private, matching C#). */
  static createInstance(base64Json: string): Base64JsonMessage {
    return new Base64JsonMessage(base64Json);
  }
}
