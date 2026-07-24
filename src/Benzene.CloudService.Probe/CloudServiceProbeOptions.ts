/** Port of Benzene.CloudService.Probe.CloudServiceProbeOptions. */
import { CloudServiceProbePaths } from './CloudServiceProbePaths';

/**
 * Configures a `CloudServiceProbe` run. Every path defaults to the profile's `/benzene/*` standard; the
 * target service itself is the `baseUrl` passed to `CloudServiceProbe.runAsync`.
 */
export class CloudServiceProbeOptions {
  /** The wire-envelope endpoint to probe for R4/R6. Defaults to `CloudServiceProbePaths.invoke`. */
  invokePath: string = CloudServiceProbePaths.invoke;

  /** The derived spec endpoint to probe for R5. Defaults to `CloudServiceProbePaths.spec`. */
  specPath: string = CloudServiceProbePaths.spec;

  /** The health endpoint to probe for R3. Defaults to `CloudServiceProbePaths.health`. */
  healthPath: string = CloudServiceProbePaths.health;

  /**
   * When true (the default), the R4 and R6 probe requests carry a synthetic W3C `traceparent` header, and
   * R8's reason notes whether the service still responded correctly with it attached. A weak,
   * explicitly-labeled non-breakage signal only - it never upgrades R8 past `Inconclusive`. Set false to
   * skip sending it.
   */
  sendTraceParentProbe = true;

  /**
   * True when every path is still at its `/benzene/*` default. R7 can only be assessed when this holds -
   * once the caller points the probe elsewhere, it can no longer tell whether the service's OWN defaults
   * are `/benzene/*`.
   */
  get usesDefaultPaths(): boolean {
    return (
      this.invokePath === CloudServiceProbePaths.invoke &&
      this.specPath === CloudServiceProbePaths.spec &&
      this.healthPath === CloudServiceProbePaths.health
    );
  }
}
