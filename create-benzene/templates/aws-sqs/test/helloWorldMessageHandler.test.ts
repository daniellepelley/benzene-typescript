import { describe, expect, it } from 'vitest';
import { benzeneTestHost, messageBuilder } from '@benzene/testing';
// Importing the AWS testing package provides `asSqs` AND lights up the `.buildAwsLambdaHost()` method
// on the neutral test host (module augmentation).
import { asSqs } from '@benzene/aws-lambda-testing';
import { StartUp } from '../src/startUp';
import { IGreeter } from '../src/greeter';

/**
 * A component test: it boots the SAME app your `StartUp` configures for a real deployment — both
 * `configureServices` and `configure` run — then pushes a message through the whole Benzene pipeline.
 * Only the SQS trigger is simulated. `.withServices` / `.withConfiguration` are the seams for overriding
 * any dependency or setting the test needs; here we swap the real `IGreeter` for a spy so we can assert
 * the handler actually ran with the routed message.
 */
class SpyGreeter implements IGreeter {
  readonly greeted: string[] = [];
  greet(name: string): void {
    this.greeted.push(name);
  }
}

function buildHost(greeter: IGreeter) {
  return benzeneTestHost(StartUp)
    .withServices((services) => services.addSingletonInstance(IGreeter, greeter))
    .withConfiguration('Example:Setting', 'test-value')
    .buildAwsLambdaHost();
}

describe('HelloWorldMessageHandler', () => {
  it('routing the demo topic invokes the handler', async () => {
    const greeter = new SpyGreeter();
    const host = buildHost(greeter);

    await host.sendEventAsync(asSqs(messageBuilder('hello:world', { name: 'World' })));

    expect(greeter.greeted).toEqual(['World']);
    host.dispose();
  });

  it('an unknown topic does not reach the handler', async () => {
    const greeter = new SpyGreeter();
    const host = buildHost(greeter);

    await host.sendEventAsync(asSqs(messageBuilder('does:not-exist', { name: 'World' })));

    expect(greeter.greeted).toEqual([]);
    host.dispose();
  });
});
