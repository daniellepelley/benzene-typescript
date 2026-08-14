import { describe, expect, it } from 'vitest';
import { benzeneTestHost, httpBuilder } from '@benzenejs/testing';
// Importing the AWS testing package provides `asApiGatewayRequest` AND lights up the
// `.buildAwsLambdaHost()` method on the neutral test host (module augmentation).
import { asApiGatewayRequest } from '@benzenejs/aws-lambda-testing';
import { StartUp } from '../src/startUp';
import { IGreeter } from '../src/greeter';

/**
 * A component test: it boots the SAME app your `StartUp` configures for a real deployment — both
 * `configureServices` and `configure` run — then sends an HTTP request through the whole Benzene
 * pipeline. Only the API Gateway trigger is simulated. `.withServices` / `.withConfiguration` are the
 * seams for overriding any dependency or setting the test needs; here we swap the real `IGreeter` for a
 * spy so we can both assert on the returned response AND prove the injected collaborator was used.
 */
class SpyGreeter implements IGreeter {
  readonly greeted: string[] = [];
  greet(name: string): string {
    this.greeted.push(name);
    return `Hi ${name} (from the spy)`;
  }
}

function buildHost(greeter: IGreeter) {
  return benzeneTestHost(StartUp)
    .withServices((services) => services.addSingletonInstance(IGreeter, greeter))
    .withConfiguration('Example:Setting', 'test-value')
    .buildAwsLambdaHost();
}

interface ApiGatewayResult {
  statusCode: number;
  body: string;
}

describe('HelloWorldMessageHandler', () => {
  it('POST /hello returns a greeting from the injected service', async () => {
    const greeter = new SpyGreeter();
    const host = buildHost(greeter);

    const response = await host.sendEventAsync<ApiGatewayResult>(
      asApiGatewayRequest(httpBuilder('POST', '/hello', { name: 'World' })),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ message: 'Hi World (from the spy)' });
    expect(greeter.greeted).toEqual(['World']);
    host.dispose();
  });

  it('an unmapped route returns NotFound', async () => {
    const host = buildHost(new SpyGreeter());

    const response = await host.sendEventAsync<ApiGatewayResult>(
      asApiGatewayRequest(httpBuilder('GET', '/does-not-exist')),
    );

    expect(response.statusCode).toBe(404);
    host.dispose();
  });
});
