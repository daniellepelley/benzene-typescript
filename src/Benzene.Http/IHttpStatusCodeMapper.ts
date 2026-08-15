import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * Maps a Benzene result-status string to an HTTP status-code string (e.g. `"Ok"` -> `"200"`).
 * Port of Benzene.Http.IHttpStatusCodeMapper.
 */
export interface IHttpStatusCodeMapper {
  /**
   * Maps a Benzene result status to an HTTP status code (as a string), with the result's
   * `IBenzeneResult.isSuccessful` optionally available alongside its status. Port of C#'s two `Map`
   * overloads.
   *
   * Deviation: C# declares `Map(string)` plus a defaulted `Map(string, bool)` that delegates to it,
   * so a custom mapper implementing only the status-only overload keeps working. TypeScript
   * interfaces carry no default implementations, so the pair collapses into one method with an
   * **optional** `isSuccessful` — a custom mapper that ignores the second parameter is the exact
   * equivalent of overriding only C#'s status-only overload.
   *
   * `isSuccessful` only ever matters for a status outside the known vocabulary: the framework's own
   * `DefaultHttpStatusCodeMapper` maps an application-defined *successful* status to `"200"` rather
   * than the generic-error row, since the caller's `isSuccessful` — not the necessarily incomplete
   * mapping table — is the authoritative signal for a custom status. A known status always maps by
   * its own row regardless.
   */
  map(benzeneResultStatus: string | undefined, isSuccessful?: boolean): string;
}

export const IHttpStatusCodeMapper: ServiceToken<IHttpStatusCodeMapper> =
  serviceToken<IHttpStatusCodeMapper>('IHttpStatusCodeMapper');
