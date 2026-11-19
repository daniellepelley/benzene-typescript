import { IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { BenzeneResult } from '@benzenejs/results';
import { EntityTags } from './EntityTags';

/**
 * Optimistic concurrency for a handler: checks the request's `If-Match` against the resource's current
 * entity tag before it changes anything.
 * Port of Benzene.Http.Conditional.Preconditions (C# `IBenzeneResult<T>?` -> `| undefined`).
 *
 * @example
 * ```ts
 * const failed = Preconditions.checkIfMatch<TaskDto>(request.ifMatch, EntityTags.strong(task.version));
 * if (failed) return failed; // 428 with no If-Match, 412 with a stale one
 * ```
 *
 * .NET also ships `ConditionalRequestEnricher`, which binds `If-Match`/`If-None-Match` onto `IfMatch`/
 * `IfNoneMatch` request properties on every HTTP host. It is not ported: TypeScript erases the request
 * type, so an enricher can only fill a property the deserialized body already has. Pass the `If-Match`
 * value however the request carries it.
 */
export const Preconditions = {
  /**
   * Returns `undefined` when `ifMatch` matches `currentETag` (strong comparison, `*` matching any).
   * Otherwise returns the failure to answer with: `precondition-required` (428) when there is no
   * `If-Match` and `required` is true, else `precondition-failed` (412). With `required` false, a
   * request without `If-Match` passes.
   */
  checkIfMatch<T = VoidResult>(
    ifMatch: string | undefined | null,
    currentETag: string,
    required = true,
  ): IBenzeneResultOf<T> | undefined {
    if (ifMatch === undefined || ifMatch === null || ifMatch.trim() === '') {
      return required
        ? BenzeneResult.preconditionRequired<T>(
            "This operation requires an If-Match header with the resource's current ETag.",
          )
        : undefined;
    }

    return EntityTags.ifMatch(ifMatch, currentETag)
      ? undefined
      : BenzeneResult.preconditionFailed<T>('The resource has changed since the ETag in If-Match was issued.');
  },
} as const;
