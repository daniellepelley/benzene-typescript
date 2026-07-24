import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CloudServiceProbe,
  CloudServiceProbeOptions,
  CloudServiceProbePaths,
  CloudServiceProbeReport,
  CloudServiceProbeVerdict,
} from '@benzene/cloud-service-probe';

/**
 * Port of test/Benzene.Core.Test/CloudService/Probe/CloudServiceProbeTest.cs. The C# loopback
 * `HttpListener` + real `HttpClient` become a `node:http` server the real global `fetch` probes - the same
 * real-HTTP approach (no mocking), since this exercises genuine HTTP behaviour.
 */

interface Scripted {
  status: number;
  json: string;
}

interface Handlers {
  onHealth?: () => Scripted;
  onSpec?: () => Scripted;
  onInvoke?: (topic: string) => Scripted;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function startFake(
  paths: { health: string; spec: string; invoke: string },
  handlers: Handlers,
): Promise<string> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const write = (r: Scripted): void => {
      res.statusCode = r.status;
      res.setHeader('content-type', 'application/json');
      res.end(r.json);
    };

    if (path === paths.health && handlers.onHealth) {
      write(handlers.onHealth());
    } else if (path === paths.spec && handlers.onSpec) {
      write(handlers.onSpec());
    } else if (path === paths.invoke && handlers.onInvoke) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let topic = '';
        try {
          topic = (JSON.parse(body) as { topic?: string }).topic ?? '';
        } catch {
          topic = '';
        }
        write(handlers.onInvoke!(topic));
      });
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

function envelope(body: string): string {
  return JSON.stringify({ statusCode: 'ok', headers: {}, body });
}

function verdictOf(report: CloudServiceProbeReport, id: string): CloudServiceProbeVerdict {
  const requirement = report.requirements.find((x) => x.id === id);
  expect(requirement, `requirement ${id} present`).toBeDefined();
  return requirement!.verdict;
}

function reasonOf(report: CloudServiceProbeReport, id: string): string {
  return report.requirements.find((x) => x.id === id)!.reason.toLowerCase();
}

const defaultPaths = {
  health: CloudServiceProbePaths.health,
  spec: CloudServiceProbePaths.spec,
  invoke: CloudServiceProbePaths.invoke,
};

describe('CloudServiceProbe', () => {
  it('FullyConformantService_ReportsSatisfiedForEverythingExceptR8AndTheRegistrationHalfOfR6', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 200, json: '{"isHealthy":true}' }),
      onSpec: () => ({ status: 200, json: '{"openapi":"3.0.0"}' }),
      onInvoke: (topic) => {
        if (topic === 'healthcheck') return { status: 200, json: envelope('{"isHealthy":true}') };
        if (topic === 'mesh') return { status: 200, json: envelope('{"service":"orders","topics":[{"id":"order:create"}]}') };
        return { status: 404, json: '{}' };
      },
    });

    const report = await CloudServiceProbe.runAsync(baseUrl);

    expect(verdictOf(report, 'R1')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R2')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R3')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R4')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R5')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R6')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R7')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R8')).toBe(CloudServiceProbeVerdict.Inconclusive);

    // R6's reason must still say the registration/heartbeat half was never verified.
    expect(reasonOf(report, 'R6')).toContain('registration');
    expect(reasonOf(report, 'R6')).toContain('cannot be observed');
    // R8 is never observable from one service.
    expect(reasonOf(report, 'R8')).toContain('cannot be verified');

    report.requirements.forEach((x) => expect(x.reason.trim()).not.toBe(''));
  });

  it('HealthEndpointReturns503WithValidBody_R3IsSatisfied', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 503, json: '{"isHealthy":false}' }),
      onSpec: () => ({ status: 200, json: '{"openapi":"3.0.0"}' }),
      onInvoke: (topic) =>
        topic === 'healthcheck' ? { status: 503, json: envelope('{"isHealthy":false}') } : { status: 404, json: '{}' },
    });

    const report = await CloudServiceProbe.runAsync(baseUrl);

    expect(verdictOf(report, 'R3')).toBe(CloudServiceProbeVerdict.Satisfied);
  });

  it('HealthEndpointReturnsUnexpectedStatus_R3IsNotSatisfied', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 500, json: '{"isHealthy":false}' }),
      onSpec: () => ({ status: 200, json: '{"openapi":"3.0.0"}' }),
      onInvoke: () => ({ status: 404, json: '{}' }),
    });

    const report = await CloudServiceProbe.runAsync(baseUrl);

    expect(verdictOf(report, 'R3')).toBe(CloudServiceProbeVerdict.NotSatisfied);
  });

  it('UnreachableService_IsNotSatisfiedAndCascadesSensibly', async () => {
    const port = await freePort(); // nothing listening

    const report = await CloudServiceProbe.runAsync(`http://127.0.0.1:${port}`);

    expect(verdictOf(report, 'R1')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(verdictOf(report, 'R3')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(verdictOf(report, 'R4')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(verdictOf(report, 'R5')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(verdictOf(report, 'R6')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(verdictOf(report, 'R2')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(verdictOf(report, 'R7')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(verdictOf(report, 'R8')).toBe(CloudServiceProbeVerdict.Inconclusive);
  });

  it('SpecMissing_R5FailsWhileHealthAndInvokePass_AndR2DegradesToInconclusive', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 200, json: '{"isHealthy":true}' }),
      onSpec: () => ({ status: 404, json: '{}' }),
      onInvoke: (topic) =>
        topic === 'healthcheck' ? { status: 200, json: envelope('{"isHealthy":true}') } : { status: 404, json: '{}' },
    });

    const report = await CloudServiceProbe.runAsync(baseUrl);

    expect(verdictOf(report, 'R3')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R4')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R5')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(verdictOf(report, 'R6')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(verdictOf(report, 'R2')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(verdictOf(report, 'R7')).toBe(CloudServiceProbeVerdict.NotSatisfied);
  });

  it('NonDefaultPathsSupplied_ForcesR7Inconclusive_EvenWhenEverythingElseChecksOut', async () => {
    const paths = { health: '/custom/health', spec: '/custom/spec', invoke: '/custom/invoke' };
    const baseUrl = await startFake(paths, {
      onHealth: () => ({ status: 200, json: '{"isHealthy":true}' }),
      onSpec: () => ({ status: 200, json: '{"openapi":"3.0.0"}' }),
      onInvoke: (topic) => {
        if (topic === 'healthcheck') return { status: 200, json: envelope('{"isHealthy":true}') };
        if (topic === 'mesh') return { status: 200, json: envelope('{"service":"orders","topics":[]}') };
        return { status: 404, json: '{}' };
      },
    });

    const options = new CloudServiceProbeOptions();
    options.healthPath = paths.health;
    options.specPath = paths.spec;
    options.invokePath = paths.invoke;

    const report = await CloudServiceProbe.runAsync(baseUrl, options);

    expect(verdictOf(report, 'R3')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R4')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R5')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R6')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R7')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(reasonOf(report, 'R7')).toContain('non-default');
  });

  it('SendTraceParentProbeDisabled_R8StaysInconclusiveWithoutTheBonusSignal', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 200, json: '{"isHealthy":true}' }),
      onSpec: () => ({ status: 200, json: '{"openapi":"3.0.0"}' }),
      onInvoke: (topic) => {
        if (topic === 'healthcheck') return { status: 200, json: envelope('{"isHealthy":true}') };
        if (topic === 'mesh') return { status: 200, json: envelope('{"service":"orders","topics":[]}') };
        return { status: 404, json: '{}' };
      },
    });

    const options = new CloudServiceProbeOptions();
    options.sendTraceParentProbe = false;
    const report = await CloudServiceProbe.runAsync(baseUrl, options);

    expect(verdictOf(report, 'R8')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(reasonOf(report, 'R8')).not.toContain('bonus signal');
  });
});
