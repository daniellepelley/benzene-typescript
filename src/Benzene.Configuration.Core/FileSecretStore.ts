import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ISecretStore } from './ISecretStore';

/**
 * An {@link ISecretStore} that reads each value from a file named after it in a directory - the
 * Docker/Kubernetes secret-mount convention (e.g. `/run/secrets/db_password`). Keeps secrets out of
 * environment variables and image layers.
 * Port of Benzene.Configuration.Core.FileSecretStore.
 *
 * The logical name is mapped to a file name by replacing `:`, `.`, `/`, and `\` with `_`. A trailing
 * newline (which editors and `echo` add) is trimmed; other whitespace is preserved, since it may be
 * significant in a secret. A missing file resolves to `undefined` (C# `File.Exists` guard maps to
 * catching the ENOENT read error).
 */
export class FileSecretStore implements ISecretStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async getSecretAsync(name: string, signal?: AbortSignal): Promise<string | undefined> {
    const path = join(this.directory, sanitizeFileName(name));

    let content: string;
    try {
      content = await readFile(path, { encoding: 'utf8', signal });
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }

    return content.replace(/[\r\n]+$/, '');
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[:./\\]/g, '_');
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
