/** Port of Benzene.Mesh.Dispatch.MeshDispatchGate. */
import { IMeshDispatchEnvironment } from './IMeshDispatchEnvironment';
import { MeshDispatchOptions } from './MeshDispatchOptions';

/** Decides whether a dispatch is currently permitted, and gives the reason when it isn't. */
export class MeshDispatchGate {
  constructor(
    private readonly options: MeshDispatchOptions,
    private readonly environment: IMeshDispatchEnvironment,
  ) {}

  /**
   * Dispatch is allowed only outside Production, unless `allowInProduction` is explicitly set. Firing a
   * real handler with test data has real side-effects, so the default is off (an unset environment counts
   * as Production).
   */
  get isAllowed(): boolean {
    return !this.environment.isProduction || this.options.allowInProduction;
  }

  /** A human-readable reason dispatch is blocked, returned when {@link isAllowed} is false. */
  get blockedReason(): string {
    return (
      'Mesh dispatch is disabled in this environment. It invokes a service\'s real handler with the ' +
      'supplied payload (real side-effects execute), so it is off in Production unless ' +
      'MeshDispatchOptions.allowInProduction is explicitly set.'
    );
  }
}
