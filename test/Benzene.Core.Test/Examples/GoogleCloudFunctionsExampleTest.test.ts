/**
 * Drives `@benzene-example/google-cloud-functions` end-to-end without a live Functions Framework server:
 * boot the real `GoogleCloudOrdersStartUp` with `buildGoogleCloudFunctionHost(benzeneTestHost(...))`, turn a
 * neutral `httpBuilder(...)` into the native Functions Framework request with `asGoogleCloudHttpRequest`,
 * and push it through the full pipeline with `host.sendHttpAsync(...)`. Mirrors the .NET
 * `Benzene.Examples.Google.Tests` HTTP round-trip.
 */
import { describe, expect, it } from 'vitest';
import { httpBuilder } from '@benzenejs/testing';
import {
  asGoogleCloudHttpRequest,
  buildGoogleCloudFunctionHost,
} from '@benzenejs/google-cloud-functions-http-testing';
import { GoogleCloudOrdersStartUp, OrderList } from '@benzene-example/google-cloud-functions';
import { benzeneTestHost } from '@benzenejs/testing';

describe('@benzene-example/google-cloud-functions', () => {
  it('POST /orders creates an order and returns 201 with the mapped body', async () => {
    const host = buildGoogleCloudFunctionHost(benzeneTestHost(GoogleCloudOrdersStartUp));

    const response = await host.sendHttpAsync(
      asGoogleCloudHttpRequest(httpBuilder('POST', '/orders', { name: 'acme' })),
    );

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({ id: 'order-1', name: 'acme' });
  });

  it('GET /orders lists the orders created on the same host', async () => {
    const host = buildGoogleCloudFunctionHost(benzeneTestHost(GoogleCloudOrdersStartUp));

    await host.sendHttpAsync(asGoogleCloudHttpRequest(httpBuilder('POST', '/orders', { name: 'acme' })));
    await host.sendHttpAsync(asGoogleCloudHttpRequest(httpBuilder('POST', '/orders', { name: 'globex' })));

    const response = await host.sendHttpAsync(asGoogleCloudHttpRequest(httpBuilder('GET', '/orders', undefined)));

    expect(response.statusCode).toBe(200);
    const list = JSON.parse(response.body) as OrderList;
    expect(list.orders.map((o) => o.name)).toEqual(['acme', 'globex']);
  });
});
