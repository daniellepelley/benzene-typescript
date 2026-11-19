import { describe, expect, it } from 'vitest';
import { APIGatewayProxyResult } from 'aws-lambda';
import { status } from '@grpc/grpc-js';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import {
  BenzeneResult,
  BenzeneResultStatus,
  convertHttpStatusCode,
  ProblemTypes,
} from '@benzenejs/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import {
  DefaultHttpStatusCodeMapper,
  EntityTags,
  httpEndpoint,
  Preconditions,
} from '@benzenejs/http';
import { DefaultGrpcStatusCodeMapper } from '@benzenejs/grpc';
import { DefaultGrpcStatusReverseMapper } from '@benzenejs/grpc-client';
import { BenzeneResultHttpMapper, convertStatusCode } from '@benzenejs/clients';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { benzeneTestHost, httpBuilder, type BenzeneStartUp } from '@benzenejs/testing';
import { asApiGatewayRequest } from '@benzenejs/aws-lambda-testing';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';

/**
 * Port of the .NET ConditionalRequestsTest (test/Benzene.Core.Test/Http/ConditionalRequestsTest.cs):
 * spec 1.3's `precondition-failed` (412) and `precondition-required` (428) for `If-Match`.
 *
 * Not ported: the 304 cases (`Get_*`, `AzureFunctions_MatchingIfNoneMatch_Is304`). The HTTP binding's
 * 304 rule is a MAY that needs a result to carry an `ETag` response header, and this port's results
 * carry no response headers yet (docs/capability-matrix.md). `Put_CurrentIfMatch_..._IsNot304` is ported
 * without its ETag response-header assertion for the same reason.
 */

describe('ConditionalRequestsTest', () => {
  describe('EntityTags.ifMatch is a strong comparison', () => {
    const cases: [string | undefined, string, boolean][] = [
      ['"v2"', '"v2"', true],
      ['"v1", "v2"', '"v2"', true],
      ['*', '"v2"', true],
      ['"v1"', '"v2"', false],
      ['W/"v2"', '"v2"', false],
      ['"v2"', 'W/"v2"', false],
      [undefined, '"v2"', false],
    ];
    for (const [header, current, expected] of cases) {
      it(`${String(header)} vs ${current} -> ${expected}`, () => {
        expect(EntityTags.ifMatch(header, current)).toBe(expected);
      });
    }
  });

  describe('EntityTags.ifNoneMatch is a weak comparison', () => {
    const cases: [string, string, boolean][] = [
      ['"v2"', '"v2"', true],
      ['W/"v2"', '"v2"', true],
      ['"v2"', 'W/"v2"', true],
      ['"v1", W/"v2"', '"v2"', true],
      ['*', '"v2"', true],
      ['"v1"', '"v2"', false],
      ['', '"v2"', false],
    ];
    for (const [header, current, expected] of cases) {
      it(`${header || '<empty>'} vs ${current} -> ${expected}`, () => {
        expect(EntityTags.ifNoneMatch(header, current)).toBe(expected);
      });
    }
  });

  it('makes strong and weak entity tags', () => {
    expect(EntityTags.strong('v1')).toBe('"v1"');
    expect(EntityTags.weak('v1')).toBe('W/"v1"');
  });

  it('checkIfMatch', () => {
    expect(Preconditions.checkIfMatch<string>(undefined, '"v2"')?.status).toBe(BenzeneResultStatus.preconditionRequired);
    expect(Preconditions.checkIfMatch<string>(undefined, '"v2"', false)).toBeUndefined();
    expect(Preconditions.checkIfMatch<string>('"v1"', '"v2"')?.status).toBe(BenzeneResultStatus.preconditionFailed);
    expect(Preconditions.checkIfMatch<string>('"v2"', '"v2"')).toBeUndefined();
  });

  it('the new statuses are failures', () => {
    expect(BenzeneResultStatus.isFailure(BenzeneResultStatus.preconditionFailed)).toBe(true);
    expect(BenzeneResultStatus.isFailure(BenzeneResultStatus.preconditionRequired)).toBe(true);
    expect(BenzeneResultStatus.isTransient(BenzeneResultStatus.preconditionFailed)).toBe(false);
    expect(BenzeneResult.preconditionFailed<string>().isSuccessful).toBe(false);
    expect(BenzeneResult.preconditionRequired<string>('needs If-Match').errors).toEqual([{ message: 'needs If-Match' }]);
    expect(convertHttpStatusCode(304).status).toBe(BenzeneResultStatus.ok);
    expect(convertHttpStatusCode(412).status).toBe(BenzeneResultStatus.preconditionFailed);
    expect(convertHttpStatusCode(428).status).toBe(BenzeneResultStatus.preconditionRequired);
  });

  it('maps both statuses through the HTTP, gRPC and problem-type tables', () => {
    const http = new DefaultHttpStatusCodeMapper();
    expect(http.map(BenzeneResultStatus.preconditionFailed)).toBe('412');
    expect(http.map(BenzeneResultStatus.preconditionRequired)).toBe('428');

    const grpc = new DefaultGrpcStatusCodeMapper();
    expect(grpc.map(BenzeneResultStatus.preconditionFailed)).toBe(status.FAILED_PRECONDITION);
    expect(grpc.map(BenzeneResultStatus.preconditionRequired)).toBe(status.FAILED_PRECONDITION);
    expect(new DefaultGrpcStatusReverseMapper().map(status.FAILED_PRECONDITION, undefined)).toBe(
      BenzeneResultStatus.preconditionFailed,
    );

    expect(ProblemTypes.typeFor(BenzeneResultStatus.preconditionFailed)).toBe(ProblemTypes.preconditionFailed);
    expect(ProblemTypes.typeFor(BenzeneResultStatus.preconditionRequired)).toBe(ProblemTypes.preconditionRequired);
    expect(ProblemTypes.httpStatusFor(BenzeneResultStatus.preconditionFailed)).toBe(412);
    expect(ProblemTypes.httpStatusFor(BenzeneResultStatus.preconditionRequired)).toBe(428);
  });

  it('reads 412, 428 and 304 on the HTTP client paths', () => {
    expect(BenzeneResultHttpMapper.map<string>('412').status).toBe(BenzeneResultStatus.preconditionFailed);
    expect(BenzeneResultHttpMapper.map<string>('428').status).toBe(BenzeneResultStatus.preconditionRequired);
    expect(BenzeneResultHttpMapper.map<string>('304').isSuccessful).toBe(true);
    expect(BenzeneResultHttpMapper.normalizeStatus('412')).toBe(BenzeneResultStatus.preconditionFailed);
    expect(BenzeneResultHttpMapper.normalizeStatus('precondition-required')).toBe(BenzeneResultStatus.preconditionRequired);

    const notModified = convertStatusCode(304, 'cached');
    expect(notModified.status).toBe(BenzeneResultStatus.ok);
    expect(notModified.isSuccessful).toBe(true);
    expect(convertStatusCode(412, 'ignored').isSuccessful).toBe(false);
    expect(convertStatusCode(428, 'ignored').status).toBe(BenzeneResultStatus.preconditionRequired);
  });

  describe('If-Match through an API Gateway host', () => {
    class ETagTaskRequest {
      title: string | undefined;
      ifMatch: string | undefined;
    }

    class ETagTaskDto {
      title: string | undefined;
      etag: string | undefined;
    }

    const store = { version: 'v2', title: 'write the docs' };
    const registry = new MessageHandlersRegistry();

    @httpEndpoint('PUT', '/etag-tasks/1')
    @message('etag-task:update', { registry, requestType: ETagTaskRequest, responseType: ETagTaskDto })
    class UpdateETagTaskHandler implements IMessageHandler<ETagTaskRequest, ETagTaskDto> {
      handleAsync(request: ETagTaskRequest): Promise<IBenzeneResultOf<ETagTaskDto>> {
        const failed = Preconditions.checkIfMatch<ETagTaskDto>(request.ifMatch, EntityTags.strong(store.version));
        if (failed) {
          return Promise.resolve(failed);
        }
        const dto = new ETagTaskDto();
        dto.title = request.title;
        dto.etag = EntityTags.strong('v3');
        return Promise.resolve(BenzeneResult.ok(dto));
      }
    }

    class StartUp implements BenzeneStartUp {
      configureServices(services: IBenzeneServiceContainer): void {
        addBenzene(services);
      }

      configure(app: IBenzeneApplicationBuilder): void {
        useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, UpdateETagTaskHandler)));
      }
    }

    // The entity tag travels on the request (`ifMatch`): .NET's ConditionalRequestEnricher, which binds
    // the If-Match header onto that property, is not ported (see Preconditions).
    function put(ifMatch?: string) {
      return asApiGatewayRequest(httpBuilder('PUT', '/etag-tasks/1', { title: 'new', ifMatch }));
    }

    it('no If-Match is 428 with a problem document', async () => {
      const response = await benzeneTestHost(StartUp).buildAwsLambdaHost().sendEventAsync<APIGatewayProxyResult>(put());

      expect(response.statusCode).toBe(428);
      expect(response.body).toContain('https://benzene.app/problems/precondition-required');
    });

    it('a stale If-Match is 412 with a problem document', async () => {
      const response = await benzeneTestHost(StartUp)
        .buildAwsLambdaHost()
        .sendEventAsync<APIGatewayProxyResult>(put('"v1"'));

      expect(response.statusCode).toBe(412);
      expect(response.body).toContain('https://benzene.app/problems/precondition-failed');
    });

    it('the current If-Match succeeds', async () => {
      const response = await benzeneTestHost(StartUp)
        .buildAwsLambdaHost()
        .sendEventAsync<APIGatewayProxyResult>(put('"v2"'));

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ title: 'new', etag: '"v3"' });
    });
  });
});
