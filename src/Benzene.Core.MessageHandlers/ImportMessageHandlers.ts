import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * TypeScript-only file with no direct C# counterpart.
 *
 * In .NET, handlers are discovered by scanning loaded assemblies; in Node,
 * a module's `@message` decorator only runs once the module is imported. This
 * helper imports every module under a directory (recursively) so decorated
 * handlers self-register with the MessageHandlersRegistry — the automatic
 * equivalent of assembly scanning:
 *
 *     await importMessageHandlers(new URL('./handlers', import.meta.url).pathname);
 *     const finder = new RegistryMessageHandlersFinder();
 *
 * Declaration files (`.d.ts`) and test files are skipped by default.
 */
export interface ImportMessageHandlersOptions {
  /** File extensions to import. Defaults to .js, .mjs, .cjs and .ts (for tsx/vitest-style runtimes). */
  extensions?: string[];
  /** Whether to recurse into subdirectories. Defaults to true. */
  recursive?: boolean;
}

const defaultExtensions = ['.js', '.mjs', '.cjs', '.ts'];

export async function importMessageHandlers(
  directory: string,
  options: ImportMessageHandlersOptions = {},
): Promise<void> {
  const extensions = options.extensions ?? defaultExtensions;
  const recursive = options.recursive ?? true;

  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        await importMessageHandlers(fullPath, options);
      }
      continue;
    }

    if (
      !extensions.includes(extname(entry.name)) ||
      entry.name.endsWith('.d.ts') ||
      /\.(test|spec)\.[cm]?[jt]s$/.test(entry.name)
    ) {
      continue;
    }

    await import(pathToFileURL(fullPath).href);
  }
}
