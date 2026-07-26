import { describe, expect, it } from 'vitest';
import { APIGatewayAuthorizerResult, Context } from 'aws-lambda';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { addBenzene } from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import {
  ApiGatewayCustomAuthorizerApplication,
  ApiGatewayCustomAuthorizerContext,
  useApiGatewayCustomAuthorizer,
  useCustomAuthorizer,
} from '@benzene/aws-lambda-api-gateway';
import { httpBuilder } from '@benzene/testing';
import { asApiGatewayCustomAuthorizerEvent } from '@benzene/aws-lambda-testing';

/**
 * End-to-end port of the C# custom-authorizer pipeline tests
 * (test/Benzene.Core.Test/Aws/ApiGateway/ApiGatewayCustomAuthorizerMessagePipelineTest.cs): drive an
 * API Gateway REQUEST-type authorizer event through the pipeline and assert the returned IAM policy /
 * principal, both directly (`ApiGatewayCustomAuthorizerApplication`) and via the outer AWS Lambda entry
 * point (`useApiGatewayCustomAuthorizer`).
 */

const fakeLambdaContext = {} as Context;

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

describe('ApiGatewayCustomAuthorizer (via AwsLambdaEntryPoint)', () => {
  it('routes an authorizer event through useApiGatewayCustomAuthorizer and returns the policy', async () => {
    let seen: ApiGatewayCustomAuthorizerContext | undefined;

    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) =>
        useApiGatewayCustomAuthorizer(app, (message) =>
          useCustomAuthorizer(message, (request) => {
            expect(request.requestContext.apiId).toBe('some-id');
            return okPolicy('some-id', 'some-version');
          }).onResponse((context) => {
            seen = context;
          }),
        ),
      )
      .build();

    const response = (await entryPoint.functionHandlerAsync(
      createRequest(),
      fakeLambdaContext,
    )) as APIGatewayAuthorizerResult;

    expect(response.principalId).toBe('some-id');
    expect(response.policyDocument.Version).toBe('some-version');
    expect(seen?.apiGatewayCustomAuthorizerResponse?.principalId).toBe('some-id');
  });

  it('defers (event unrecognized) when the request has no API ID', async () => {
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) =>
        useApiGatewayCustomAuthorizer(app, (message) =>
          useCustomAuthorizer(message, () => okPolicy('some-id')),
        ),
      )
      .build();

    // apiId empty -> canHandle is false -> no route claims it -> the entry point reports "not recognized".
    await expect(
      entryPoint.functionHandlerAsync(createRequest(''), fakeLambdaContext),
    ).rejects.toThrow(/not been recognized/);
  });
});
