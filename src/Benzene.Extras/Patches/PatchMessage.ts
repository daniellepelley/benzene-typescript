/** Port of Benzene.Extras.Patches.PatchMessage. */
import { IPatchMessage } from './IPatchMessage';

/** Default {@link IPatchMessage} base with a mutable, initially-empty updated-fields list. */
export class PatchMessage implements IPatchMessage {
  readonly updatedFields: string[] = [];
}
