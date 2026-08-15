import { IBenzeneResult } from '@benzenejs/abstractions';
import { BenzeneError } from './BenzeneError';
import { BenzeneResultStatus } from './BenzeneResultStatus';
import { ProblemDetails } from './ProblemDetails';

/**
 * The problem-type registry: `type` URI / `title` / HTTP status keyed by the existing
 * {@link BenzeneResultStatus} failure vocabulary — no new taxonomy (see
 * `docs/specification/wire-contracts.md` §3.1 in the cross-language Benzene spec repo).
 * Port of Benzene.Results.ProblemTypes.
 *
 * A pure, static, spec-pinned table, matching {@link BenzeneResultStatus}'s own pattern: C#'s
 * `static class` of `const string` members plus static methods collapses into a frozen object
 * literal here.
 */
const baseUri = 'https://benzene.app/problems/';

const unknownHttpStatus = 500;

interface RegistryRow {
  readonly type: string;
  readonly title: string;
  readonly httpStatus: number;
}

// One row per failure status (docs/specification/wire-contracts.md §3.1). Success statuses have no
// problem type - problems exist only on failure - so they're deliberately absent here.
const registry: Readonly<Record<string, RegistryRow>> = {
  [BenzeneResultStatus.badRequest]: { type: `${baseUri}bad-request`, title: 'Bad request', httpStatus: 400 },
  [BenzeneResultStatus.unauthorized]: { type: `${baseUri}unauthorized`, title: 'Unauthorized', httpStatus: 401 },
  [BenzeneResultStatus.forbidden]: { type: `${baseUri}forbidden`, title: 'Forbidden', httpStatus: 403 },
  [BenzeneResultStatus.notFound]: { type: `${baseUri}not-found`, title: 'Not found', httpStatus: 404 },
  [BenzeneResultStatus.conflict]: { type: `${baseUri}conflict`, title: 'Conflict', httpStatus: 409 },
  [BenzeneResultStatus.validationError]: { type: `${baseUri}validation-error`, title: 'Validation failed', httpStatus: 422 },
  [BenzeneResultStatus.tooManyRequests]: { type: `${baseUri}too-many-requests`, title: 'Too many requests', httpStatus: 429 },
  [BenzeneResultStatus.unexpectedError]: { type: `${baseUri}unexpected-error`, title: 'Unexpected error', httpStatus: 500 },
  [BenzeneResultStatus.notImplemented]: { type: `${baseUri}not-implemented`, title: 'Not implemented', httpStatus: 501 },
  [BenzeneResultStatus.serviceUnavailable]: { type: `${baseUri}service-unavailable`, title: 'Service unavailable', httpStatus: 503 },
  [BenzeneResultStatus.timeout]: { type: `${baseUri}timeout`, title: 'Timeout', httpStatus: 504 },
};

function rowFor(status: string | undefined): RegistryRow | undefined {
  return status === undefined ? undefined : registry[status];
}

export const ProblemTypes = {
  /** The {@link ProblemDetails.type} URI for `bad-request`. */
  badRequest: `${baseUri}bad-request`,

  /** The {@link ProblemDetails.type} URI for `unauthorized`. */
  unauthorized: `${baseUri}unauthorized`,

  /** The {@link ProblemDetails.type} URI for `forbidden`. */
  forbidden: `${baseUri}forbidden`,

  /** The {@link ProblemDetails.type} URI for `not-found`. */
  notFound: `${baseUri}not-found`,

  /** The {@link ProblemDetails.type} URI for `conflict`. */
  conflict: `${baseUri}conflict`,

  /** The {@link ProblemDetails.type} URI for `validation-error`. */
  validationError: `${baseUri}validation-error`,

  /** The {@link ProblemDetails.type} URI for `too-many-requests`. */
  tooManyRequests: `${baseUri}too-many-requests`,

  /** The {@link ProblemDetails.type} URI for `unexpected-error`. */
  unexpectedError: `${baseUri}unexpected-error`,

  /** The {@link ProblemDetails.type} URI for `not-implemented`. */
  notImplemented: `${baseUri}not-implemented`,

  /** The {@link ProblemDetails.type} URI for `service-unavailable`. */
  serviceUnavailable: `${baseUri}service-unavailable`,

  /** The {@link ProblemDetails.type} URI for `timeout`. */
  timeout: `${baseUri}timeout`,

  /**
   * The registry {@link ProblemDetails.type} URI for `status`, or `undefined` for an
   * application-defined status the registry doesn't know (the application owns its own `type`, or
   * omits one).
   */
  typeFor(status: string | undefined): string | undefined {
    return rowFor(status)?.type;
  },

  /**
   * The registry {@link ProblemDetails.title} for `status`, or `undefined` for an
   * application-defined status the registry doesn't know.
   */
  titleFor(status: string | undefined): string | undefined {
    return rowFor(status)?.title;
  },

  /**
   * The HTTP status code the registry maps `status` to, or `500` for an application-defined status —
   * the same "unknown status falls to the generic-error row" rule the {@link BenzeneResultStatus}-based
   * HTTP mappings use elsewhere (e.g. `DefaultHttpStatusCodeMapper`).
   */
  httpStatusFor(status: string | undefined): number {
    return rowFor(status)?.httpStatus ?? unknownHttpStatus;
  },

  /**
   * Builds the problem document for a failed `result`: {@link ProblemDetails.type}/
   * {@link ProblemDetails.title} from the registry (both `undefined` for an application-defined
   * status), {@link ProblemDetails.detail} as the result's error messages joined with `", "`
   * (unchanged from the retired `ErrorPayload`'s construction), {@link ProblemDetails.benzeneStatus}
   * as the result's status, and {@link ProblemDetails.errors} as the result's structured errors when
   * non-empty (else `undefined`, so the member is omitted from the wire). Deliberately never sets
   * {@link ProblemDetails.status} — the numeric HTTP status is an HTTP-binding concern, filled in by
   * the HTTP-aware response mapper, not this transport-neutral factory.
   *
   * Deviation: `IBenzeneResult.errors` is `string[]` in the port (C# carries a
   * `IReadOnlyList<BenzeneError>`), so each message is lifted into a {@link BenzeneError} with only
   * its required `message` member — `field`/`code` have no source to come from here.
   */
  from(result: IBenzeneResult): ProblemDetails {
    const messages = result.errors ?? [];
    const detail = messages.join(', ');

    const problem = new ProblemDetails();
    problem.type = ProblemTypes.typeFor(result.status);
    problem.title = ProblemTypes.titleFor(result.status);
    problem.detail = detail === '' ? undefined : detail;
    problem.benzeneStatus = result.status;
    problem.errors =
      messages.length > 0 ? messages.map((message): BenzeneError => ({ message })) : undefined;

    return problem;
  },
} as const;
