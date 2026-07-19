import { describe, expect, it } from 'vitest';
import { LoggingProcessTimer, LoggingProcessTimerFactory } from '@benzene/diagnostics';
import { FakeLoggerFactory } from '../Logging/Helpers/FakeLoggerFactory';

/** Port of Benzene.Test.Diagnostics.LoggingProcessTimerTest. */
describe('LoggingProcessTimerTest', () => {
  it('Constructor_LogsAStartedMessage', () => {
    const loggerFactory = new FakeLoggerFactory();
    const logger = loggerFactory.createLogger('my-category');

    const timer = new LoggingProcessTimer('my-timer', logger);
    timer.dispose();

    expect(loggerFactory.collector.entries.some((e) => e.message === 'my-timer started')).toBe(true);
  });

  it('Dispose_NoTagsSet_LogsElapsedTimeWithoutTags', () => {
    const loggerFactory = new FakeLoggerFactory();
    const logger = loggerFactory.createLogger('my-category');

    const timer = new LoggingProcessTimer('my-timer', logger);
    timer.dispose();

    const entries = loggerFactory.collector.entries;
    const completionMessage = entries[entries.length - 1].message;
    expect(completionMessage.startsWith('my-timer took')).toBe(true);
    expect(completionMessage).not.toContain('Tags');
  });

  it('Dispose_TagsSet_LogsElapsedTimeWithEachTag', () => {
    const loggerFactory = new FakeLoggerFactory();
    const logger = loggerFactory.createLogger('my-category');

    const timer = new LoggingProcessTimer('my-timer', logger);
    timer.setTag('status', 'ok');
    timer.dispose();

    const entries = loggerFactory.collector.entries;
    const completionMessage = entries[entries.length - 1].message;
    expect(completionMessage.startsWith('my-timer took')).toBe(true);
    expect(completionMessage).toContain('Tags = status:ok');
  });

  it('Create_DelegatesToLoggingProcessTimerWithTheGivenName', () => {
    const loggerFactory = new FakeLoggerFactory();
    const factory = new LoggingProcessTimerFactory(loggerFactory.createLogger('LoggingProcessTimer'));

    const timer = factory.create('my-timer');
    timer.dispose();

    expect(loggerFactory.collector.entries.some((e) => e.message === 'my-timer started')).toBe(true);
  });
});
