import { IDisposable, ILogger, ILoggerFactory, LogLevel, LoggerBase } from '@benzene/abstractions';

/** Port of the C# test helper Benzene.Test.Logging.Helpers.FakeLoggerFactory. */
export interface LogEntry {
  readonly category: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly error: unknown;
  readonly scopes: Readonly<Record<string, unknown>>[];
}

export class LogCollector {
  readonly entries: LogEntry[] = [];
  /** Active scopes, shared across loggers like .NET's ambient logger scopes. */
  readonly scopes: Readonly<Record<string, unknown>>[] = [];
}

class FakeLogger extends LoggerBase {
  constructor(
    private readonly category: string,
    private readonly collector: LogCollector,
  ) {
    super();
  }

  log(logLevel: LogLevel, message: string, error?: unknown): void {
    this.collector.entries.push({
      category: this.category,
      level: logLevel,
      message,
      error,
      scopes: [...this.collector.scopes],
    });
  }

  beginScope(state: Readonly<Record<string, unknown>>): IDisposable {
    this.collector.scopes.push(state);
    return {
      dispose: () => {
        const index = this.collector.scopes.indexOf(state);
        if (index >= 0) {
          this.collector.scopes.splice(index, 1);
        }
      },
    };
  }
}

export class FakeLoggerFactory implements ILoggerFactory {
  readonly collector = new LogCollector();

  createLogger(categoryName: string): ILogger {
    return new FakeLogger(categoryName, this.collector);
  }
}
