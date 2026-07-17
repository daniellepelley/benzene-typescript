import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { OperationCanceledException } from './OperationCanceledException';

/** A function that delays for the given number of milliseconds. Port of C# `Func<TimeSpan, Task>`. */
export type DelayFunc = (delayMs: number) => Promise<void>;

/**
 * Options for {@link RetryMiddleware}. Mirrors the C# constructor's optional parameters;
 * `TimeSpan` maps to a millisecond `number`.
 */
export interface RetryOptions<TContext> {
  numberOfRetries?: number;
  /** Initial delay in milliseconds before the first retry (C# `TimeSpan? initialDelay`). */
  initialDelayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown) => boolean;
  shouldRetryContext?: (context: TContext) => boolean;
  delay?: DelayFunc;
}

const defaultDelay: DelayFunc = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

/**
 * Retries the rest of the pipeline on failure, with exponential backoff.
 * Port of Benzene.Resilience.RetryMiddleware&lt;TContext&gt;.
 *
 * Deviations: C# `TimeSpan` becomes a millisecond `number`; the C# `catch (ex) when (filter)`
 * exception filter becomes an explicit rethrow when the filter is not satisfied; the default
 * retry predicate excludes {@link OperationCanceledException} (the ported stand-in for
 * `System.OperationCanceledException`), matching C# `ex is not OperationCanceledException`.
 */
export class RetryMiddleware<TContext> implements IMiddleware<TContext> {
  private readonly numberOfRetries: number;
  private readonly initialDelayMs: number;
  private readonly backoffFactor: number;
  private readonly shouldRetry: (error: unknown) => boolean;
  private readonly shouldRetryContext: (context: TContext) => boolean;
  private readonly delay: DelayFunc;

  constructor(options: RetryOptions<TContext> = {}) {
    this.numberOfRetries = options.numberOfRetries ?? 3;
    this.initialDelayMs = options.initialDelayMs ?? 200;
    this.backoffFactor = options.backoffFactor ?? 2.0;
    this.shouldRetry = options.shouldRetry ?? RetryMiddleware.defaultShouldRetry;
    this.shouldRetryContext = options.shouldRetryContext ?? (() => false);
    this.delay = options.delay ?? defaultDelay;
  }

  readonly name = 'RetryMiddleware';

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    let attempt = 0;
    let delay = this.initialDelayMs;

    for (;;) {
      try {
        await next();

        if (attempt >= this.numberOfRetries || !this.shouldRetryContext(context)) {
          return;
        }
      } catch (error) {
        // Port of the C# `catch when (attempt < retries && shouldRetry(ex))` filter:
        // if the filter is not satisfied, the exception propagates unchanged.
        if (!(attempt < this.numberOfRetries && this.shouldRetry(error))) {
          throw error;
        }
      }

      attempt++;
      await this.delay(delay);
      delay = delay * this.backoffFactor;
    }
  }

  private static defaultShouldRetry(error: unknown): boolean {
    return !(error instanceof OperationCanceledException);
  }
}
