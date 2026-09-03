import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAtomicClientSdk, buildMessageClientSdk, parseContractDocument } from '@benzenejs/codegen-client';
import { CliError, run, writeGeneratedFiles } from '../../../src/Benzene.CodeGen.Client/Cli';

/**
 * W1.4 — codegen file-write containment (the .NET R18 #292 ruling, ported): the CLI's writer
 * resolves every target path and requires it to live inside the resolved `--out` directory
 * (rejecting absolute file names outright), the `--namespace` path component gets the same check,
 * and the document-derived file-name stems stay sanitized as the first line of defense — so a
 * hostile fetched `.spec.json` cannot write outside the output directory even if one layer regresses.
 */

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'benzene-cli-containment-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A minimal, valid Contract Document. */
const validDocument = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Orders', version: '1.0.0' },
  requests: [{ topic: 'order:create' }],
  events: [],
  components: { schemas: {} },
});

describe('codegen writer containment', () => {
  it('rejects a fileName that traverses out of the output directory, without writing', async () => {
    const outDir = join(await tempDir(), 'out');
    const evil = resolve(outDir, '../evil.ts');

    await expect(
      writeGeneratedFiles(outDir, [{ fileName: '../evil.ts', source: 'evil' }]),
    ).rejects.toBeInstanceOf(CliError);

    expect(await exists(evil)).toBe(false);
  });

  it('rejects an absolute fileName, without writing', async () => {
    const outDir = join(await tempDir(), 'out');
    const evil = join(await tempDir(), 'abs-evil.ts');

    await expect(
      writeGeneratedFiles(outDir, [{ fileName: evil, source: 'evil' }]),
    ).rejects.toBeInstanceOf(CliError);

    expect(await exists(evil)).toBe(false);
  });

  it('rejects a nested fileName whose inner segments traverse out', async () => {
    const outDir = join(await tempDir(), 'out');
    const evil = resolve(outDir, '../escaped.ts');

    await expect(
      writeGeneratedFiles(outDir, [{ fileName: 'inner/../../escaped.ts', source: 'evil' }]),
    ).rejects.toBeInstanceOf(CliError);

    expect(await exists(evil)).toBe(false);
  });

  it('still writes legitimate nested file names inside the output directory', async () => {
    const outDir = join(await tempDir(), 'out');

    await writeGeneratedFiles(outDir, [
      { fileName: 'Nested/Client.ts', source: 'export const ok = true;\n' },
    ]);

    expect(await exists(join(outDir, 'Nested', 'Client.ts'))).toBe(true);
  });

  it('run() rejects a traversal-bearing --namespace without writing anything', async () => {
    const workDir = await tempDir();
    const specPath = join(workDir, 'orders.spec.json');
    await writeFile(specPath, validDocument, 'utf8');
    const outDir = join(workDir, 'out');
    const evilDir = resolve(outDir, '../escaped');

    await expect(
      run(['--file', specPath, '--output', 'client', '--service-name', 'Orders', '--namespace', '../escaped', '--out', outDir]),
    ).rejects.toBeInstanceOf(CliError);

    expect(await exists(evilDir)).toBe(false);
    expect(await exists(outDir)).toBe(false);
  });

  it('run() rejects an absolute --namespace without writing anything', async () => {
    const workDir = await tempDir();
    const specPath = join(workDir, 'orders.spec.json');
    await writeFile(specPath, validDocument, 'utf8');
    const outDir = join(workDir, 'out');
    const absoluteNamespace = join(workDir, 'somewhere-else');

    await expect(
      run(['--file', specPath, '--output', 'client', '--service-name', 'Orders', '--namespace', absoluteNamespace, '--out', outDir]),
    ).rejects.toBeInstanceOf(CliError);

    expect(await exists(absoluteNamespace)).toBe(false);
    expect(await exists(outDir)).toBe(false);
  });

  it('run() with a benign namespace still writes inside the output directory', async () => {
    const workDir = await tempDir();
    const specPath = join(workDir, 'orders.spec.json');
    await writeFile(specPath, validDocument, 'utf8');
    const outDir = join(workDir, 'out');

    await run(['--file', specPath, '--output', 'client', '--service-name', 'Orders', '--namespace', 'clients/orders', '--out', outDir]);

    expect(await exists(join(outDir, 'clients', 'orders', 'OrdersServiceClient.ts'))).toBe(true);
  });
});

describe('document-derived stems stay sanitized (pin — the first line of defense)', () => {
  it('a serviceName containing ../ yields a sanitized stem', () => {
    const generated = buildMessageClientSdk(parseContractDocument(validDocument), {
      serviceName: '../../../etc/Evil',
      namespace: '',
    });

    // The stem keeps only identifier characters — no dots, no separators.
    expect(generated.fileName).toBe('EtcEvilServiceClient.ts');
  });

  it('a topic containing ../ yields sanitized per-topic client stems', () => {
    const hostile = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Evil', version: '1.0.0' },
      requests: [{ topic: '../../evil:create' }],
      events: [],
      components: { schemas: {} },
    });
    const files = buildAtomicClientSdk(parseContractDocument(hostile), { namespace: '' });

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.fileName).not.toContain('..');
      // Every path segment is a sanitized identifier (per-topic clients live in their own folder).
      for (const segment of file.fileName.split('/')) {
        expect(segment).toMatch(/^[A-Za-z0-9_]+(\.ts)?$/);
      }
    }
  });
});
