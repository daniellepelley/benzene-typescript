import { ServiceToken, serviceToken } from '../DI/ServiceToken';

/**
 * TypeScript stand-in for `Microsoft.Extensions.Logging`.
 *
 * The .NET version of Benzene logs through the platform's `ILogger`/`ILoggerFactory`
 * abstractions. Node has no platform equivalent, so this file ports the minimal
 * surface Benzene uses (levels, structured scopes, category loggers). Adapters for
 * concrete logging libraries (pino, winston, ...) can implement these interfaces,
 * exactly as Microsoft.Extensions.Logging providers do in .NET.
 */

export enum LogLevel {
  Trace = 0,
  Debug = 1,
  Information = 2,
  Warning = 3,
  Error = 4,
  Critical = 5,
}

/** Port of C# `IDisposable` for logger scopes. */
export interface IDisposable {
  dispose(): void;
}

export interface ILogger {
  log(logLevel: LogLevel, message: string, error?: unknown): void;

  /** Port of C# `ILogger.BeginScope(state)`. */
  beginScope(state: Readonly<Record<string, unknown>>): IDisposable;

  /** Port of C# `LogInformation`. */
  logInformation(message: string): void;

  /** Port of C# `LogWarning`. */
  logWarning(message: string): void;

  /** Port of C# `LogError(exception, message)`. */
  logError(error: unknown, message: string): void;

  /** Port of C# `LogDebug`. */
  logDebug(message: string): void;
}

export const ILogger: ServiceToken<ILogger> = serviceToken<ILogger>('ILogger');

export interface ILoggerFactory {
  /** Port of C# `ILoggerFactory.CreateLogger(categoryName)`. */
  createLogger(categoryName: string): ILogger;
}

export const ILoggerFactory: ServiceToken<ILoggerFactory> =
  serviceToken<ILoggerFactory>('ILoggerFactory');

/** Base class implementing the level-specific helpers in terms of `log`. */
export abstract class LoggerBase implements ILogger {
  abstract log(logLevel: LogLevel, message: string, error?: unknown): void;

  abstract beginScope(state: Readonly<Record<string, unknown>>): IDisposable;

  logInformation(message: string): void {
    this.log(LogLevel.Information, message);
  }

  logWarning(message: string): void {
    this.log(LogLevel.Warning, message);
  }

  logError(error: unknown, message: string): void {
    this.log(LogLevel.Error, message, error);
  }

  logDebug(message: string): void {
    this.log(LogLevel.Debug, message);
  }
}

/** Port of `Microsoft.Extensions.Logging.Abstractions.NullLogger`. */
export class NullLogger extends LoggerBase {
  static readonly instance: NullLogger = new NullLogger();

  log(): void {}

  beginScope(): IDisposable {
    return { dispose: () => {} };
  }
}

/** Port of `Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory`. */
export class NullLoggerFactory implements ILoggerFactory {
  static readonly instance: NullLoggerFactory = new NullLoggerFactory();

  createLogger(): ILogger {
    return NullLogger.instance;
  }
}
