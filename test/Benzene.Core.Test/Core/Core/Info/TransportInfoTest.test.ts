import { describe, expect, it } from 'vitest';
import {
  ApplicationInfo,
  BlankApplicationInfo,
  CurrentTransportInfo,
  TransportInfo,
  TransportsInfo,
} from '@benzene/core-message-handlers';

/** Tests for the ported Benzene.Core.MessageHandlers.Info implementations. */
describe('TransportsInfo', () => {
  it('exposes the distinct names of every registered transport', () => {
    const transportsInfo = new TransportsInfo([
      new TransportInfo('http'),
      new TransportInfo('sqs'),
      new TransportInfo('http'),
    ]);

    expect(transportsInfo.transports).toEqual(['http', 'sqs']);
  });

  it('is empty when no transports are registered', () => {
    expect(new TransportsInfo([]).transports).toEqual([]);
  });
});

describe('CurrentTransportInfo', () => {
  it('starts out reporting the missing sentinel until a transport is set', () => {
    const current = new CurrentTransportInfo();

    expect(current.name).toBe('<missing>');
  });

  it('reports the transport recorded via setTransport', () => {
    const current = new CurrentTransportInfo();

    current.setTransport('sqs');

    expect(current.name).toBe('sqs');
  });
});

describe('ApplicationInfo', () => {
  it('exposes the supplied name, version and description', () => {
    const info = new ApplicationInfo('my-app', '1.2.3', 'does things');

    expect(info.name).toBe('my-app');
    expect(info.version).toBe('1.2.3');
    expect(info.description).toBe('does things');
  });
});

describe('BlankApplicationInfo', () => {
  it('exposes empty strings for every property', () => {
    const info = new BlankApplicationInfo();

    expect(info.name).toBe('');
    expect(info.version).toBe('');
    expect(info.description).toBe('');
  });
});
