import { Span } from '@opentelemetry/api';
import { BenzeneDiagnostics } from '../BenzeneDiagnostics';
import { IProcessTimer } from './IProcessTimer';
import { IProcessTimerFactory } from './IProcessTimerFactory';

/**
 * An {@link IProcessTimer} backed by a span: construction starts the span, {@link dispose} ends it.
 * Kept as a source-compatible adapter for existing `useTimer(app, name)` call sites.
 * Port of Benzene.Diagnostics.Timers.ActivityProcessTimer.
 *
 * .NET's nullable `Activity?` (null when nothing listens) maps to an always-present span whose
 * `setAttribute`/`end` are no-ops when it isn't recording.
 */
export class ActivityProcessTimer implements IProcessTimer {
  private readonly span: Span;

  constructor(timerName: string) {
    this.span = BenzeneDiagnostics.tracer.startSpan(timerName);
  }

  setTag(key: string, value: string): void {
    this.span.setAttribute(key, value);
  }

  dispose(): void {
    this.span.end();
  }
}

/**
 * Creates {@link ActivityProcessTimer} instances. The default {@link IProcessTimerFactory} registered by
 * `addDiagnostics`.
 * Port of Benzene.Diagnostics.Timers.ActivityProcessTimerFactory.
 */
export class ActivityProcessTimerFactory implements IProcessTimerFactory {
  create(timerName: string): IProcessTimer {
    return new ActivityProcessTimer(timerName);
  }
}
