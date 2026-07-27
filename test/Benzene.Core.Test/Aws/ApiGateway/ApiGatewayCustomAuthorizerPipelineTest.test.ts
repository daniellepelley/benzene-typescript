import { describe, expect, it } from 'vitest';
import { APIGatewayAuthorizerResult } from 'aws-lambda';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { addBenzene } from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { useAwsLambda } from '@benzene/aws-lambda-core';
import {
  ApiGatewayCustomAuthorizerApplication,
  ApiGatewayCustomAuthorizerContext,
  useApiGatewayCustomAuthorizer,
  useCustomAuthorizer,
} from '@benzene/aws-lambda-api-gateway';
import { benzeneTestHost, httpBuilder, type BenzeneStartUp } from '@benzene/testing';
import { asApiGatewayCustomAuthorizerEvent } from '@benzene/aws-lambda-testing';

/**
 * End-to-end port of the C# custom-authorizer pipeline tests
 * (test/Benzene.Core.Test/Aws/ApiGateway/ApiGatewayCustomAuthorizerMessagePipelineTest.cs): drive an
 * API Gateway REQUEST-type authorizer event through the pipeline and assert the returned IAM policy /
 * principal, both directly (`ApiGatewayCustomAuthorizerApplication`) and via the outer AWS Lambda entry
 * point (`useApiGatewayCustomAuthorizer`).
 */

function createRequest(apiId = 'some-id') {
  return asApiGatewayCustomAuthorizerEvent(httpBuilder('GET', '/example', { value: 'some-message' }), {
    apiId,
  });
}

function okPolicy(principalId: string, version?: string): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: version ?? '2012-10-17',
      Statement: [],
    },
  };
}

describe('ApiGatewayCustomAuthorizerApplication (direct)', () => {
  it('runs a manual middleware step that sets the authorizer response', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);

    const pipeline = new MiddlewarePipelineBuilder<ApiGatewayCustomAuthorizerContext>(container)
      .useFn((context, next) => {
        context.apiGatewayCustomAuthorizerResponse = okPolicy('some-id');
        return next();
      })
      .build();

    const application = new ApiGatewayCustomAuthorizerApplication(pipeline);
    const response = await application.handleAsync(
      createRequest(),
      container.createServiceResolverFactory(),
    );

    expect(response).not.toBeUndefined();
    expect(response.principalId).toBe('some-id');
  });

  it('runs a useCustomAuthorizer step', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);

    const builder = new MiddlewarePipelineBuilder<ApiGatewayCustomAuthorizerContext>(container);
    useCustomAuthorizer(builder, () => Promise.resolve(okPolicy('some-id')));

    const application = new ApiGatewayCustomAuthorizerApplication(builder.build());
    const response = await application.handleAsync(
      createRequest(),
      container.createServiceResolverFactory(),
    );

    expect(response).not.toBeUndefined();
    expect(response.principalId).toBe('some-id');
  });
});

describe('ApiGatewayCustomAuthorizer (via the benzeneTestHost harness)', () => {
  it('routes an authorizer event through useApiGatewayCustomAuthorizer and returns the policy', async () => {
    let seen: ApiGatewayCustomAuthorizerContext | undefined;

    // The startup closes over `seen`, so it is declared inside the test.
    class CustomAuthorizerStartUp implements BenzeneStartUp {
      configureServices(services: IBenzeneServiceContainer): void {
        addBenzene(services);
      }

      configure(app: IBenzeneApplicationBuilder): void {
        useAwsLambda(app, (aws) =>
          useApiGatewayCustomAuthorizer(aws, (message) =>
            useCustomAuthorizer(message, (request) => {
              expect(request.requestContext.apiId).toBe('some-id');
              return okPolicy('some-id', 'some-version');
            }).onResponse((context) => {
              seen = context;
            }),
          ),
        );
      }
    }

    const host = benzeneTestHost(CustomAuthorizerStartUp).buildAwsLambdaHost();
    const response = await host.sendEventAsync<APIGatewayAuthorizerResult>(createRequest());

    expect(response.principalId).toBe('some-id');
    expect(response.policyDocument.Version).toBe('some-version');
    expect(seen?.apiGatewayCustomAuthorizerResponse?.principalId).toBe('some-id');
  });

  it('defers (event unrecognized) when the request has no API ID', async () => {
    class CustomAuthorizerStartUp implements BenzeneStartUp {
      configureServices(services: IBenzeneServiceContainer): void {
        addBenzene(services);
      }

      configure(app: IBenzeneApplicationBuilder): void {
        useAwsLambda(app, (aws) =>
          useApiGatewayCustomAuthorizer(aws, (message) =>
            useCustomAuthorizer(message, () => okPolicy('some-id')),
          ),
        );
      }
    }

    const host = benzeneTestHost(CustomAuthorizerStartUp).buildAwsLambdaHost();

    // apiId empty -> canHandle is false -> no route claims it -> the entry point reports "not recognized".
    await expect(host.sendEventAsync(createRequest(''))).rejects.toThrow(/not been recognized/);
  });
});
