/** Port of Benzene.Mesh.Aggregator.FileSystemMeshArtifactStore. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { IMeshArtifactStore } from './IMeshArtifactStore';

/**
 * An `IMeshArtifactStore` that publishes artifacts to a directory on local disk.
 *
 * `File.WriteAllTextAsync`/`ReadAllTextAsync`/`Directory.CreateDirectory` -> `node:fs/promises`;
 * `Path.Combine`/`Path.GetFullPath` -> `node:path`'s `resolve`. A missing file on read surfaces as
 * `ENOENT`, mapped to `undefined` (C# `File.Exists` check).
 */
export class FileSystemMeshArtifactStore implements IMeshArtifactStore {
  /**
   * @param rootDirectory The directory artifacts are written under. Created on first write if it doesn't exist.
   */
  constructor(private readonly rootDirectory: string) {}

  async publishAsync(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolveWithinRoot(relativePath);
    const directory = dirname(fullPath);
    if (directory.length > 0) {
      await mkdir(directory, { recursive: true });
    }

    await writeFile(fullPath, content, 'utf8');
  }

  async tryReadAsync(relativePath: string): Promise<string | undefined> {
    const fullPath = this.resolveWithinRoot(relativePath);
    try {
      return await readFile(fullPath, 'utf8');
    } catch (ex) {
      if (isNotFound(ex)) {
        return undefined;
      }
      throw ex;
    }
  }

  /**
   * Resolves `relativePath` against the store root and asserts the result stays inside it. The relative
   * path can carry a service name that originated in an untrusted push report (`services/{report.name}.json`),
   * so a value like `"../../etc/passwd"` or a rooted path would otherwise let path-combination escape the
   * root and read or overwrite an arbitrary file. Resolving to a full path and checking containment closes
   * that traversal at the storage boundary, protecting every caller.
   */
  private resolveWithinRoot(relativePath: string): string {
    const rootFull = resolve(this.rootDirectory);
    const combined = resolve(rootFull, relativePath);

    const rootWithSeparator = rootFull.endsWith(sep) ? rootFull : rootFull + sep;

    if (combined !== rootFull && !combined.startsWith(rootWithSeparator)) {
      throw new Error(`The artifact path '${relativePath}' resolves outside the store root and was rejected.`);
    }

    return combined;
  }
}

function isNotFound(ex: unknown): boolean {
  return typeof ex === 'object' && ex !== null && (ex as { code?: string }).code === 'ENOENT';
}
