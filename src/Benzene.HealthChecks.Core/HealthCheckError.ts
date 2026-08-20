/** Port of Benzene.HealthChecks.Core.HealthCheckError. */
import { HealthCheckDependency } from './HealthCheckDependency';
import { HealthCheckResult } from './HealthCheckResult';
import { IHealthCheckResult } from './IHealthCheckResult';

/**
 * Builds a classified failure result from a probe error, applying the shared policy so every client
 * check reports failures the same way:
 *
 * - A permission/authorization error is a **persistent** `failed` (`IHealthCheckResult.isPersistent`).
 *   It is a deterministic misconfiguration (a missing permission or bad credentials) that will not
 *   self-heal, so it must **not** be softened by the non-critical downgrade: it surfaces as unhealthy
 *   on the deep `benzene:healthcheck` layer even for an auto-wired dependency check. Detected by *meaning*
 *   (HTTP 401/403 **or** a known authorization error code), so the same denial classifies identically
 *   whether the SDK returns 403 or — like AWS EventBridge's `AccessDeniedException` — HTTP 400.
 * - Any other failure (not-found, outage, timeout, bad connectivity, throttling) is a transient
 *   `failed` that the non-critical downgrade still softens to a warning.
 *
 * The error **message** is never included (it may carry a connection string or other secret); only the
 * non-sensitive structured discriminators go into `data` — the error name, plus the SDK's error code
 * and HTTP status when the caller can supply them. This lives in the cloud-agnostic core: the caller
 * (an AWS/Azure client check) extracts the `errorCode`/`statusCode` from its own SDK error and passes
 * them in, so the classification *policy* and `data` shape are defined once with no cloud-SDK
 * dependency.
 */
export const HealthCheckError = {
  // Well-known SDK error codes that mean "not authorized" regardless of the HTTP status number the SDK
  // happens to surface. Kept small; the 401/403 status check is always the fallback. Case-insensitive.
  authorizationErrorCodes: new Set(
    [
      'accessdenied', // AWS S3 and others
      'accessdeniedexception', // AWS EventBridge/Lambda/StepFunctions (surfaced as HTTP 400)
      'authorizationerror', // AWS SNS
      'authorizationfailure', // Azure
      'authenticationfailed', // Azure Storage
      'forbidden',
      'unauthorized',
    ],
  ),

  /** Whether an HTTP status indicates a permission/authorization problem rather than an outage. */
  isPermissionStatus(statusCode?: number): boolean {
    return statusCode === 401 || statusCode === 403;
  },

  /**
   * Whether a failure is an authorization/permission denial — a **persistent**, deterministic fault
   * (missing permission, bad credentials) that will not self-heal. Detected by the error's *meaning*:
   * HTTP 401/403 **or** a known authorization `errorCode` (some SDKs surface an access-denied as HTTP
   * 400, so keying on the status number alone would misclassify it).
   */
  isAuthorizationFailure(statusCode?: number, errorCode?: string): boolean {
    return (
      this.isPermissionStatus(statusCode) ||
      (errorCode !== undefined && errorCode !== '' && this.authorizationErrorCodes.has(errorCode.toLowerCase()))
    );
  },

  /**
   * Classifies `error` into a health-check result under the shared policy. Returns a **persistent**
   * `failed` for an authorization denial, otherwise a transient `failed`.
   *
   * @param type The check's identifier.
   * @param error The error the probe threw. Only its *name* is reported, never its message.
   * @param dependencies The dependencies the check verifies, preserved onto the result.
   * @param options.errorCode The SDK's non-sensitive error code, if available.
   * @param options.statusCode The HTTP status the SDK surfaced, if available.
   * @param options.data Optional check-specific diagnostic entries to include (never secrets).
   * @param options.requiredPermission On an authorization denial, the permission the probe needs.
   */
  classify(
    type: string,
    error: unknown,
    dependencies: HealthCheckDependency[],
    options: {
      errorCode?: string;
      statusCode?: number;
      data?: Record<string, unknown>;
      requiredPermission?: string;
    } = {},
  ): IHealthCheckResult {
    const { errorCode, statusCode, data, requiredPermission } = options;
    const payload: Record<string, unknown> = { ...(data ?? {}) };
    payload['Error'] = error instanceof Error ? error.constructor.name : typeof error;

    const isAuthFailure = this.isAuthorizationFailure(statusCode, errorCode);
    // On an authorization denial, name the permission the probe needs so the health surface tells the
    // operator the exact fix — a reachability probe often needs a read-only permission distinct from
    // the data-path one, and that requirement must travel with the check, not live only in docs.
    if (requiredPermission !== undefined && requiredPermission !== '' && isAuthFailure) {
      payload['RequiredPermission'] = requiredPermission;
    }
    if (errorCode !== undefined && errorCode !== '') {
      payload['ErrorCode'] = errorCode;
    }
    if (statusCode !== undefined) {
      payload['StatusCode'] = statusCode;
    }

    // An authorization denial is a persistent fault that escapes the non-critical downgrade; any other
    // failure is a transient failed the downgrade may still soften to a warning for a dependency check.
    return isAuthFailure
      ? HealthCheckResult.createPersistentFailure(type, payload, dependencies)
      : HealthCheckResult.createInstance(false, type, payload, dependencies);
  },
} as const;
