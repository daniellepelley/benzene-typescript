/** Port of Benzene.Azure.Function.Timer.TimerTriggerInfo (and TimerScheduleStatus). */

/**
 * The schedule bookkeeping the Functions host tracks for a timer — last/next occurrence and when the
 * status was last updated. Property names match the `@azure/functions` `Timer.scheduleStatus` JSON.
 */
export class TimerScheduleStatus {
  /** The last recorded schedule occurrence. */
  last?: Date;

  /** The expected next schedule occurrence. */
  next?: Date;

  /** When the schedule status was last updated. */
  lastUpdated?: Date;
}

/**
 * Benzene's own model of a timer trigger tick — dependency-free, shaped to bind directly from the
 * `@azure/functions` `Timer` JSON (bind the trigger parameter as this type, or map the two — the
 * property names match).
 */
export class TimerTriggerInfo {
  /**
   * Whether this tick is running later than scheduled (e.g. after a host restart with `runOnStartup`
   * or a missed schedule).
   */
  isPastDue = false;

  /** The schedule bookkeeping for this timer, when the host provides it. */
  scheduleStatus?: TimerScheduleStatus;
}
