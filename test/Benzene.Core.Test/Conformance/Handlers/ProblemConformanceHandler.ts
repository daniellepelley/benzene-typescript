import { BenzeneError, IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult, BenzeneResultStatus, ProblemDetails } from '@benzenejs/results';
import { conformanceRegistry } from './GreetConformanceHandler';

export class ProblemRequest {
  message = '';
  field?: string;
  code?: string;
  appType?: string;
}

/**
 * Canonical conformance handler (see docs/specification/conformance/README.md and
 * problem-details-cases.json's `envelopeCases`): always returns a `validation-error` result carrying
 * exactly one structured error built from the request's `message`/`field`/`code`.
 *
 * When `appType` is given, the emitted problem document's `type` is that value verbatim instead of
 * the registry URI — the application-authored-problem case (wire-contracts.md §1.3) — via
 * `BenzeneResult.problem`. `benzeneStatus` is still `validation-error` and `errors` still carries
 * the one structured error either way. Port of the .NET ProblemConformanceHandler.
 */
@message('conformance:problem', {
  registry: conformanceRegistry,
  requestType: ProblemRequest,
  responseType: VoidResult,
})
export class ProblemConformanceHandler implements IMessageHandler<ProblemRequest, VoidResult> {
  handleAsync(request: ProblemRequest): Promise<IBenzeneResultOf<VoidResult>> {
    const error: BenzeneError = {
      message: request.message,
      ...(request.field === undefined ? {} : { field: request.field }),
      ...(request.code === undefined ? {} : { code: request.code }),
    };

    if (request.appType !== undefined && request.appType !== '') {
      const problem = new ProblemDetails();
      problem.type = request.appType;
      problem.benzeneStatus = BenzeneResultStatus.validationError;
      problem.errors = [error];
      return Promise.resolve(BenzeneResult.problem<VoidResult>(problem));
    }

    return Promise.resolve(BenzeneResult.validationError<VoidResult>(error));
  }
}
