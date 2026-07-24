import { AddressInfo, createServer, Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import { HealthCheckStatus } from '@benzene/health-checks-core';
import { TcpHealthCheck } from '@benzene/health-checks-tcp';

/**
 * Ports test/Benzene.Core.Test/HealthChecks/Tcp/TcpHealthCheckTest.cs. C#'s `TcpListener` becomes a
 * `node:net` server: a listening port accepts -> healthy; a bound-then-released port refuses -> failed.
 */

/** Starts a listening TCP server on an OS-assigned free port and returns it plus the chosen port. */
function listenOnFreePort(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('TcpHealthCheck', () => {
  it('ExecuteAsync_PortAccepting_ReturnsHealthy', async () => {
    const { server, port } = await listenOnFreePort();
    try {
      const result = await new TcpHealthCheck('127.0.0.1', port).executeAsync();

      expect(result.status).toBe(HealthCheckStatus.ok);
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0]!.kind).toBe('Tcp');
      expect(result.dependencies[0]!.name).toBe(`127.0.0.1:${port}`);
    } finally {
      await close(server);
    }
  });

  it('ExecuteAsync_ConnectionRefused_ReturnsUnhealthy_WithTheDependency', async () => {
    // Bind to grab a free port, then release it so nothing is listening -> connection refused.
    const { server, port } = await listenOnFreePort();
    await close(server);

    const result = await new TcpHealthCheck('127.0.0.1', port).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect('Error' in result.data).toBe(true);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]!.name).toBe(`127.0.0.1:${port}`);
  });
});
