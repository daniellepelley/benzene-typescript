/** Port of Benzene.Mesh.Tracing.Tempo.PrometheusSample. */

/** One timeseries sample returned by a Prometheus instant query - a label set and its current value. */
export class PrometheusSample {
  /**
   * @param labels The sample's label set (e.g. `client`, `server`). `IReadOnlyDictionary` -> `Record`.
   * @param value The sample's current value.
   */
  constructor(
    readonly labels: Record<string, string>,
    readonly value: number,
  ) {}
}
