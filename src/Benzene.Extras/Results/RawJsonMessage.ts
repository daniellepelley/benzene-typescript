/** Port of Benzene.Extras.Results.RawJsonMessage. */
import { IRawJsonMessage } from '@benzene/abstractions';

/** A concrete {@link IRawJsonMessage} carrying a pre-rendered JSON string. */
export class RawJsonMessage implements IRawJsonMessage {
  constructor(readonly json: string) {}
}
