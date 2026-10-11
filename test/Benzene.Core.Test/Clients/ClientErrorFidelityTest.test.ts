import { describe, expect, it } from 'vitest';
import { IBenzeneResult } from '@benzenejs/abstractions';
import { BenzeneClientContext } from '@benzenejs/abstractions-messages';
import { asBenzeneResult, BenzeneMessageClientResponse } from '@benzenejs/clients';
import { HttpContextConverter, HttpSendMessageContext } from '@benzenejs/clients-http';
import {
  DefaultResponsePayloadMapper,
  JsonSerializer,
  MessageHandlerDefinition,
  MessageHandlerResult,
} from '@benzenejs/core-message-handlers';
import { Topic } from '@benzenejs/core-messages';
import { BenzeneResultStatus, ProblemTypes } from '@benzenejs/results';

/**
 * core-concepts §12 "Error fidelity" (wire-contracts.md §1.3): a client that receives a problem document
 * rebuilds the result's `errors` with `field` and `code` intact, and attaches the document. The
 * fixture-driven proof is the "client error fidelity" group of ProblemDetailsConformanceTest; these pin
 * the edges around it.
 */
const serializer = new JsonSerializer();

const problem = {
  type: 'https://example.com/problems/out-of-stock',
  title: 'Out of stock',
  status: 409,
  detail: 'SKU 42 is out of stock, Try later',
  benzeneStatus: 'conflict',
  errors: [
    { message: 'SKU 42 is out of stock', field: '/items/0/sku', code: 'OutOfStock' },
    { message: 'Try later' },
  ],
  retryAfter: 30,
};

function envelope(body: string, isSuccessful = false): BenzeneMessageClientResponse {
  return new BenzeneMessageClientResponse('conflict', body, { 'content-type': 'application/problem+json' }, isSuccessful);
}

async function overHttp(status: number, body: string, contentType?: string): Promise<IBenzeneResult> {
  const context = new HttpSendMessageContext({ url: '/orders', method: 'POST', headers: {}, body: '' });
  context.response = new Response(body, { status, headers: contentType === undefined ? {} : { 'content-type': contentType } });
  const clientContext = new BenzeneClientContext<unknown, unknown>({ topic: 'order:create', message: {}, headers: {} });
  await new HttpContextConverter<unknown, unknown>('POST', '/orders').mapResponseAsync(clientContext, context);
  return clientContext.response as IBenzeneResult;
}

describe('envelope client (asBenzeneResult)', () => {
  it('rebuilds errors from a failure body, field and code intact and in order, and attaches the document', () => {
    const result = asBenzeneResult<unknown>(envelope(JSON.stringify(problem)), serializer);
    expect(result.isSuccessful).toBe(false);
    expect(result.status).toBe('conflict');
    expect(result.errors).toEqual(problem.errors);
    expect(ProblemTypes.from(result)).toEqual(problem);
  });

  it('reads a document with no errors member as one opaque detail message - never split on commas', () => {
    const { errors: _errors, ...withoutErrors } = problem;
    const result = asBenzeneResult<unknown>(envelope(JSON.stringify(withoutErrors)), serializer);
    expect(result.errors).toEqual([{ message: 'SKU 42 is out of stock, Try later' }]);
  });

  it('takes a present errors member as authoritative, even empty', () => {
    const result = asBenzeneResult<unknown>(envelope(JSON.stringify({ ...problem, errors: [] })), serializer);
    expect(result.errors).toEqual([]);
  });

  it('yields no errors for no detail, an empty body or a body that is not a problem document', () => {
    expect(asBenzeneResult<unknown>(envelope(JSON.stringify({ benzeneStatus: 'conflict' })), serializer).errors).toEqual([]);
    expect(asBenzeneResult<unknown>(envelope(''), serializer).errors).toEqual([]);
    const notJson = asBenzeneResult<unknown>(envelope('<html>bad gateway</html>'), serializer);
    expect(notJson.isSuccessful).toBe(false);
    expect(notJson.errors).toEqual([]);
  });
});

describe('HTTP client (HttpContextConverter)', () => {
  it('rebuilds errors from an application/problem+json failure, keeping the status the HTTP code maps to', async () => {
    const result = await overHttp(409, JSON.stringify(problem), 'application/problem+json; charset=utf-8');
    expect(result.isSuccessful).toBe(false);
    expect(result.status).toBe(BenzeneResultStatus.conflict);
    expect(result.errors).toEqual(problem.errors);
    expect(ProblemTypes.from(result).type).toBe(problem.type);
  });

  it('matches the content type case-insensitively', async () => {
    expect((await overHttp(422, JSON.stringify(problem), 'Application/Problem+JSON')).errors).toEqual(problem.errors);
  });

  it('parses nothing from a failure that is not application/problem+json', async () => {
    const json = await overHttp(409, JSON.stringify(problem), 'application/json');
    expect(json.status).toBe(BenzeneResultStatus.conflict);
    expect(json.errors).toEqual([]);

    const html = await overHttp(502, '<html>bad gateway</html>', 'text/html');
    expect(html.status).toBe(BenzeneResultStatus.serviceUnavailable);
    expect(html.isSuccessful).toBe(false);
  });

  it('still deserializes a success body as the payload', async () => {
    const result = (await overHttp(200, JSON.stringify({ reference: 'r-1' }), 'application/json')) as IBenzeneResult & {
      payload: unknown;
    };
    expect(result.isSuccessful).toBe(true);
    expect(result.payload).toEqual({ reference: 'r-1' });
  });
});

describe('re-emitting a received document (DefaultResponsePayloadMapper)', () => {
  it('passes the received document on without its HTTP status, which an envelope must omit', async () => {
    const received = await overHttp(409, JSON.stringify(problem), 'application/problem+json');
    const body = new DefaultResponsePayloadMapper().map(
      {},
      new MessageHandlerResult(new Topic('order:create'), MessageHandlerDefinition.empty(), received),
      serializer,
    );
    const { status: _status, ...withoutStatus } = problem;
    expect(JSON.parse(body!)).toEqual(withoutStatus);
    // The attached document itself is untouched.
    expect(ProblemTypes.from(received).status).toBe(409);
  });
});
