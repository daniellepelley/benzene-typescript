import { ProblemDetails } from './ProblemDetails';

/**
 * The serialized error body produced for a failed result: carries the result status and the
 * result's errors joined into a single `detail` string.
 * Port of Benzene.Results.ErrorPayload.
 *
 * The C# parameterless constructor collapses into the single optional-argument constructor here.
 */
export class ErrorPayload extends ProblemDetails {
  constructor(status?: string, errors?: string[]) {
    super();
    if (status !== undefined) {
      this.status = status;
      this.detail = (errors ?? []).join(', ');
    }
  }
}
