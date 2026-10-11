import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CloudServiceProbe,
  CloudServiceProbeOptions,
  CloudServiceProbePaths,
  CloudServiceProbeReport,
  CloudServiceProbeVerdict,
} from '@benzenejs/cloud-service-probe';

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

function meshVerdictOf(report: CloudServiceProbeReport, id: string): CloudServiceProbeVerdict {
  const requirement = report.mesh.find((x) => x.id === id);
  expect(requirement, `mesh requirement ${id} present`).toBeDefined();
  return requirement!.verdict;
}

function meshReasonOf(report: CloudServiceProbeReport, id: string): string {
  return report.mesh.find((x) => x.id === id)!.reason.toLowerCase();
}

const defaultPaths = {
  health: CloudServiceProbePaths.health,
  spec: CloudServiceProbePaths.spec,
  invoke: CloudServiceProbePaths.invoke,
};

describe('CloudServiceProbe', () => {
  it('FullyConformantService_ReportsTheProfileSatisfied_AndTheMeshClaimInconclusiveSeparately', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 200, json: '{"isHealthy":true}' }),
      onSpec: () => ({ status: 200, json: '{"openapi":"3.0.0"}' }),
      onInvoke: (topic) => {
        if (topic === 'benzene:healthcheck') return { status: 200, json: envelope('{"isHealthy":true}') };
        if (topic === 'benzene:spec') return { status: 200, json: envelope('{"schemaDialect":"openapi-3.0","service":"orders","requests":[{"topic":"order:create","request":{}}],"events":[],"sends":[]}') };
        return { status: 404, json: '{}' };
      },
    });

    const report = await CloudServiceProbe.runAsync(baseUrl);

    expect(verdictOf(report, 'R1')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R2')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R3')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R4')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R5')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R7')).toBe(CloudServiceProbeVerdict.Satisfied);

    // The profile is R1-R5 and R7 (spec 4): R6/R8 are gone, their ids not reused.
    expect(report.requirements.map((x) => x.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R7']);
    expect(report.notSatisfied).toEqual([]);
    expect(report.inconclusive).toEqual([]);
    expect(report.isFullyConformant).toBe(true);

    // The meshed-service claim (mesh.md §7.1) is reported separately, and neither half is observable from outside.
    expect(report.mesh.map((x) => x.id)).toEqual(['M1', 'M2']);
    expect(meshVerdictOf(report, 'M1')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(meshVerdictOf(report, 'M2')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(meshReasonOf(report, 'M1')).toContain('registration');
    expect(meshReasonOf(report, 'M1')).toContain('not observable from outside');
    expect(meshReasonOf(report, 'M2')).toContain('cannot be verified');

    [...report.requirements, ...report.mesh].forEach((x) => expect(x.reason.trim()).not.toBe(''));
  });

  it('SpecServedOverHttpButNotOnTheTopic_R5IsNotSatisfied', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 200, json: '{"isHealthy":true}' }),
      onSpec: () => ({ status: 200, json: '{"service":"orders","requests":[{"topic":"order:create"}]}' }),
      onInvoke: (topic) =>
        topic === 'benzene:healthcheck' ? { status: 200, json: envelope('{"isHealthy":true}') } : { status: 404, json: '{}' },
    });

    const report = await CloudServiceProbe.runAsync(baseUrl);

    // R5 includes answering benzene:spec on every transport (spec 4), not only GET /benzene/spec.
    expect(verdictOf(report, 'R5')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(reasonOf(report, 'R5')).toContain("topic 'benzene:spec' returned 404");
    expect(verdictOf(report, 'R7')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    // R2 still reads the requests from the HTTP surface's document.
    expect(verdictOf(report, 'R2')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(report.notSatisfied).toEqual(['R5', 'R7']);
  });

  it('HealthEndpointReturns503WithValidBody_R3IsSatisfied', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 503, json: '{"isHealthy":false}' }),
      onSpec: () => ({ status: 200, json: '{"openapi":"3.0.0"}' }),
      onInvoke: (topic) =>
        topic === 'benzene:healthcheck' ? { status: 503, json: envelope('{"isHealthy":false}') } : { status: 404, json: '{}' },
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
    expect(verdictOf(report, 'R2')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(verdictOf(report, 'R7')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(meshVerdictOf(report, 'M1')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(meshVerdictOf(report, 'M2')).toBe(CloudServiceProbeVerdict.Inconclusive);
  });

  it('SpecMissing_R5FailsWhileHealthAndInvokePass_AndR2DegradesToInconclusive', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 200, json: '{"isHealthy":true}' }),
      onSpec: () => ({ status: 404, json: '{}' }),
      onInvoke: (topic) =>
        topic === 'benzene:healthcheck' ? { status: 200, json: envelope('{"isHealthy":true}') } : { status: 404, json: '{}' },
    });

    const report = await CloudServiceProbe.runAsync(baseUrl);

    expect(verdictOf(report, 'R3')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R4')).toBe(CloudServiceProbeVerdict.Satisfied);
    expect(verdictOf(report, 'R5')).toBe(CloudServiceProbeVerdict.NotSatisfied);
    expect(verdictOf(report, 'R2')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(verdictOf(report, 'R7')).toBe(CloudServiceProbeVerdict.NotSatisfied);
  });

  it('NonDefaultPathsSupplied_ForcesR7Inconclusive_EvenWhenEverythingElseChecksOut', async () => {
    const paths = { health: '/custom/health', spec: '/custom/spec', invoke: '/custom/invoke' };
    const baseUrl = await startFake(paths, {
      onHealth: () => ({ status: 200, json: '{"isHealthy":true}' }),
      onSpec: () => ({ status: 200, json: '{"openapi":"3.0.0"}' }),
      onInvoke: (topic) => {
        if (topic === 'benzene:healthcheck') return { status: 200, json: envelope('{"isHealthy":true}') };
        if (topic === 'benzene:spec') return { status: 200, json: envelope('{"schemaDialect":"openapi-3.0","service":"orders","requests":[],"events":[],"sends":[]}') };
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
    expect(verdictOf(report, 'R7')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(reasonOf(report, 'R7')).toContain('non-default');
  });

  it('SendTraceParentProbeDisabled_M2StaysInconclusiveWithoutTheBonusSignal', async () => {
    const baseUrl = await startFake(defaultPaths, {
      onHealth: () => ({ status: 200, json: '{"isHealthy":true}' }),
      onSpec: () => ({ status: 200, json: '{"openapi":"3.0.0"}' }),
      onInvoke: (topic) => {
        if (topic === 'benzene:healthcheck') return { status: 200, json: envelope('{"isHealthy":true}') };
        if (topic === 'benzene:spec') return { status: 200, json: envelope('{"schemaDialect":"openapi-3.0","service":"orders","requests":[],"events":[],"sends":[]}') };
        return { status: 404, json: '{}' };
      },
    });

    const options = new CloudServiceProbeOptions();
    options.sendTraceParentProbe = false;
    const report = await CloudServiceProbe.runAsync(baseUrl, options);

    expect(meshVerdictOf(report, 'M2')).toBe(CloudServiceProbeVerdict.Inconclusive);
    expect(meshReasonOf(report, 'M2')).not.toContain('bonus signal');
  });
});
