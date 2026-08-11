/**
 * What a failing {@link IStartUpCheck} does. One switch for all of them, on purpose.
 * Port of Benzene.Abstractions.StartUpChecks.BenzeneStartUpCheckMode.
 *
 * Individual toggles would mean a developer facing a check they think is wrong has to work out which one
 * to turn off before they can get on with their day. One switch is the difference between an escape hatch
 * and a maze.
 */
export enum BenzeneStartUpCheckMode {
  /** A failing check fails start-up. The default. */
  Enforce = 0,

  /** A failing check is logged as an error and start-up continues. */
  Advisory = 1,

  /** No checks run at all. */
  Disabled = 2,
}

/**
 * The configured {@link BenzeneStartUpCheckMode}, resolved by the runner.
 * Port of Benzene.Abstractions.StartUpChecks.BenzeneStartUpCheckOptions.
 */
export class BenzeneStartUpCheckOptions {
  /** What a failing check does. */
  readonly mode: BenzeneStartUpCheckMode;

  constructor(mode: BenzeneStartUpCheckMode = BenzeneStartUpCheckMode.Enforce) {
    this.mode = mode;
  }
}
