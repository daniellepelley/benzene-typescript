/** Port of Benzene.Extras.Patches.IPatchMessage. */

/**
 * A partial-update message that tracks which of its fields were explicitly set, so a handler can
 * distinguish "set to the default/empty value" from "not supplied" (the classic PATCH problem).
 * Port of Benzene.Extras.Patches.IPatchMessage.
 */
export interface IPatchMessage {
  /** The names (lower-cased) of the fields that have been explicitly set. */
  readonly updatedFields: string[];
}
