/** Port of Benzene.HealthChecks.HealthCheckNamer. */

/**
 * Assigns unique keys to health check results for the aggregated response dictionary, so that
 * multiple checks with the same (or an empty) `type` don't collide. Not thread-safe - a new instance
 * is created per health check run (see `HealthCheckProcessor`).
 */
export class HealthCheckNamer {
  private readonly existingNames = new Map<string, number>([['HealthCheck', 0]]);

  /**
   * Returns a unique name for a health check result. An empty/undefined `name` is treated as
   * "HealthCheck". Because "HealthCheck" is pre-seeded as already used, the first check with an empty
   * type is returned as "HealthCheck-1" rather than bare "HealthCheck"; subsequent collisions with
   * any name are suffixed -2, -3, etc.
   */
  getName(name: string | undefined): string {
    if (name) {
      return this.returnName(name);
    }
    return this.returnName('HealthCheck');
  }

  /**
   * Returns `name` unchanged the first time it is seen, otherwise appends an incrementing suffix
   * (e.g. "name-2", "name-3") to keep it unique.
   */
  returnName(name: string): string {
    if (!this.existingNames.has(name)) {
      this.existingNames.set(name, 1);
      return name;
    }

    const next = this.existingNames.get(name)! + 1;
    this.existingNames.set(name, next);
    return `${name}-${next}`;
  }
}
