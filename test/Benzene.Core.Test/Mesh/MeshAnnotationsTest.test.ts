import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileSystemMeshArtifactStore,
  MeshAnnotationPublisher,
  MeshAnnotationsMessageHandler,
} from '@benzenejs/mesh-aggregator';
import { MeshAnnotationLog, MeshAnnotationRequest } from '@benzenejs/mesh-contracts';
import { BenzeneResultStatus } from '@benzenejs/results';

/**
 * Port of test/Benzene.Mesh.Test/MeshAnnotationsTest.cs. The discussion feature's write path:
 * `MeshAnnotationPublisher` (append + artifact round-trip + corrupt-log preservation) and
 * `MeshAnnotationsMessageHandler` (validation bounds, thread response). `DateTimeOffset` -> epoch ms;
 * `ToUnixTimeSeconds()` -> `Math.floor(ms / 1000)`.
 */
// 2026-07-22T09:00:00Z (July = month index 6).
const AtMs = Date.UTC(2026, 6, 22, 9, 0, 0);

function request(
  entity: string | undefined = 'topic:order:legacy-export',
  author: string | undefined = 'dani',
  text: string | undefined = 'No consumers since May - propose retiring.',
): MeshAnnotationRequest {
  const req = new MeshAnnotationRequest();
  req.entity = entity;
  req.author = author;
  req.text = text;
  return req;
}

describe('MeshAnnotations', () => {
  let rootDirectory: string;
  const store = (): FileSystemMeshArtifactStore => new FileSystemMeshArtifactStore(rootDirectory);

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-mesh-annotations-test-'));
  });

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('AddAsync_FirstNote_CreatesTheArtifactAndReturnsTheThread', async () => {
    const s = store();
    const publisher = new MeshAnnotationPublisher(s, () => AtMs, () => 'id-1');

    const thread = await publisher.addAsync('topic:order:legacy-export', 'dani', 'propose retiring');

    expect(thread.annotations).toHaveLength(1);
    const note = thread.annotations[0]!;
    expect(note.id).toBe('id-1');
    expect(note.entity).toBe('topic:order:legacy-export');
    expect(note.createdAtUtc).toBe(AtMs);

    const log = JSON.parse((await s.tryReadAsync('annotations.json'))!) as MeshAnnotationLog;
    expect(log.annotations).toHaveLength(1);
    expect(log.annotations[0]!.text).toBe('propose retiring');
  });

  it('AddAsync_AppendsAcrossPublisherInstances_AndThreadsFilterPerEntity', async () => {
    // Durability is the artifact store's: a fresh publisher (host restart) reads the existing log. The
    // returned thread carries only the asked-for entity, oldest first.
    const s = store();
    await new MeshAnnotationPublisher(s).addAsync('service:payments-api', 'sam', 'drift here was intentional');
    const thread = await new MeshAnnotationPublisher(s).addAsync('topic:order:legacy-export', 'dani', 'propose retiring');

    expect(thread.annotations).toHaveLength(1);
    expect(thread.annotations[0]!.entity).toBe('topic:order:legacy-export');

    const log = JSON.parse((await s.tryReadAsync('annotations.json'))!) as MeshAnnotationLog;
    expect(log.annotations).toHaveLength(2);
  });

  it('AddAsync_CorruptExistingLog_IsParkedAsideNotOverwrittenSilently', async () => {
    // Notes are the one artifact that can't be regenerated from the fleet - an unreadable log must not
    // brick discussion, but must not be silently discarded either.
    const s = store();
    await s.publishAsync('annotations.json', '{not json');

    const thread = await new MeshAnnotationPublisher(s, () => AtMs).addAsync('service:payments-api', 'sam', 'first note after corruption');

    expect(thread.annotations).toHaveLength(1);
    expect(await s.tryReadAsync(`annotations.unreadable-${Math.floor(AtMs / 1000)}.json`)).toBe('{not json');
  });

  it.each([
    [undefined, 'dani', 'text', 'entity'],
    ['topic:t', undefined, 'text', 'author'],
    ['topic:t', 'dani', undefined, 'text'],
    ['topic:t', 'dani', '   ', 'text'],
  ] as [string | undefined, string | undefined, string | undefined, string][])(
    'HandleAsync_MissingField_IsBadRequest (%s, %s, %s)',
    async (entity, author, text, named) => {
      const handler = new MeshAnnotationsMessageHandler(new MeshAnnotationPublisher(store()));

      // Build directly (not via `request()`, whose default params would replace an explicit `undefined`).
      const req = new MeshAnnotationRequest();
      req.entity = entity;
      req.author = author;
      req.text = text;
      const result = await handler.handleAsync(req);

      expect(result.status).toBe(BenzeneResultStatus.badRequest);
      expect(result.errors.join(' ')).toContain(named);
    },
  );

  it('HandleAsync_OversizedText_IsBadRequest', async () => {
    const handler = new MeshAnnotationsMessageHandler(new MeshAnnotationPublisher(store()));

    const result = await handler.handleAsync(request(undefined, undefined, 'x'.repeat(MeshAnnotationsMessageHandler.MaxTextLength + 1)));

    expect(result.status).toBe(BenzeneResultStatus.badRequest);
  });

  it('HandleAsync_ValidNote_ReturnsCreatedWithTheEntityThread', async () => {
    const handler = new MeshAnnotationsMessageHandler(new MeshAnnotationPublisher(store()));

    const result = await handler.handleAsync(request());

    expect(result.status).toBe(BenzeneResultStatus.created);
    expect(result.payload!.entity).toBe('topic:order:legacy-export');
    expect(result.payload!.annotations).toHaveLength(1);
    expect(result.payload!.annotations[0]!.author).toBe('dani');
  });

  it('HandleAsync_TrimsWhitespace_BeforeStoringAndBounding', async () => {
    const handler = new MeshAnnotationsMessageHandler(new MeshAnnotationPublisher(store()));

    const result = await handler.handleAsync(request('  topic:t  ', '  dani  ', '  note  '));

    expect(result.payload!.annotations).toHaveLength(1);
    const note = result.payload!.annotations[0]!;
    expect(note.entity).toBe('topic:t');
    expect(note.author).toBe('dani');
    expect(note.text).toBe('note');
  });
});
