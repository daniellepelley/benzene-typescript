import { describe, expect, it } from 'vitest';
import { Context } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import {
  compositeAwsLambda,
  InlineAwsLambdaStartUp,
  isBenzeneMessageEvent,
  toLambdaHandler,
  useBenzeneMessage,
} from '@benzenejs/aws-lambda-core';

/**
 * The direct-invoke BenzeneMessage surface (`useBenzeneMessage`): a service answers a synchronous Lambda
 * invoke carrying a `{ topic, headers, body }` envelope with no HTTP/queue event — the seam the mesh uses to
 * interrogate a service on the reserved `benzene:spec`/`benzene:healthcheck` topics.
 */
const registry = new MessageHandlersRegistry();

class Ping {
  value?: string;
}
class Pong {
  reply?: string;
}

@message('ping', { registry, requestType: Ping, responseType: Pong })
class PingHandler implements IMessageHandler<Ping, Pong> {
  handleAsync(request: Ping): Promise<IBenzeneResultOf<Pong>> {
    const pong = new Pong();
    pong.reply = `pong:${request.value ?? '?'}`;
    return Promise.resolve(BenzeneResult.ok(pong));
  }
}

const context = {} as Context;

describe('BenzeneMessageLambdaHandler (direct invoke)', () => {
  it('routes a { topic, body } invoke to the matching handler and returns the serialized response', async () => {
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((s) => addBenzene(s))
      .configure((app) => useBenzeneMessage(app, (bm) => useMessageHandlers(bm, PingHandler)))
      .build();

    const response = (await entryPoint.functionHandlerAsync(
      { topic: 'ping', headers: {}, body: JSON.stringify({ value: '42' }) },
      context,
    )) as { statusCode: string; body: string };

    // The direct/BenzeneMessage transport reports the benzene status string (not an HTTP code); the mesh
    // reads `response.body`.
    expect(response.statusCode).toBe('ok');
    expect(JSON.parse(response.body)).toEqual({ reply: 'pong:42' });
  });

  it('isBenzeneMessageEvent discriminates a topic envelope from other event shapes', () => {
    expect(isBenzeneMessageEvent({ topic: 'ping', headers: {}, body: '' })).toBe(true);
    expect(isBenzeneMessageEvent({ httpMethod: 'GET', path: '/x' })).toBe(false); // API Gateway
    expect(isBenzeneMessageEvent({ Records: [{ eventSource: 'aws:sqs' }] })).toBe(false); // SQS
    expect(isBenzeneMessageEvent({ topic: '' })).toBe(false);
  });

  it('composes with other transports behind one composite handler', async () => {
    const handler = toLambdaHandler(
      compositeAwsLambda((c) => {
        c.configureServices((s) => addBenzene(s));
        c.route(isBenzeneMessageEvent, (app) => useBenzeneMessage(app, (bm) => useMessageHandlers(bm, PingHandler)));
      }),
    );

    const response = (await handler(
      { topic: 'ping', headers: {}, body: JSON.stringify({ value: 'composite' }) },
      context,
      () => undefined,
    )) as { statusCode: number; body: string };

    expect(JSON.parse(response.body)).toEqual({ reply: 'pong:composite' });
  });
});
