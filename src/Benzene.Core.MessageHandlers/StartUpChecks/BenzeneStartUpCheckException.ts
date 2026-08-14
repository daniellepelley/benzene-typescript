import { BenzeneException } from '@benzenejs/core';

/** A single check's failure: the check's name and the error it threw. */
export interface StartUpCheckFailure {
  readonly name: string;
  readonly error: unknown;
}

/**
 * Raised when one or more start-up checks fail in `BenzeneStartUpCheckMode.Enforce`.
 * Port of Benzene.Core.MessageHandlers.StartUpChecks.BenzeneStartUpCheckException.
 */
export class BenzeneStartUpCheckException extends BenzeneException {
  /** The names of the checks that failed. */
  readonly failedChecks: string[];

  constructor(failures: StartUpCheckFailure[]) {
    // A single failure keeps its own error as the cause; several are wrapped as an aggregate.
    super(
      BenzeneStartUpCheckException.describe(failures),
      failures.length === 1 ? failures[0]!.error : new AggregateError(failures.map((x) => x.error)),
    );
    this.name = 'BenzeneStartUpCheckException';
    this.failedChecks = failures.map((x) => x.name);
  }

  private static describe(failures: StartUpCheckFailure[]): string {
    const lines = failures.map((x) => `  - ${x.name}: ${messageOf(x.error)}`);
    return (
      `Benzene found ${failures.length} wiring problem(s) at start-up:\n` +
      lines.join('\n') +
      '\n\n' +
      'These are checked before any message is handled so they don\'t surface as a failure on the ' +
      'message path later. If a check is wrong for your application, soften or silence all of them ' +
      'with addBenzeneStartUpChecks(container, BenzeneStartUpCheckMode.Advisory) (or .Disabled).'
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
