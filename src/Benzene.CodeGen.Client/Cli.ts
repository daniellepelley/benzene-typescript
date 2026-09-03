/**
 * The `codegen-client` CLI: reads a Contract Document (`.spec.json`) and writes a generated
 * TypeScript client to disk. Port of `Benzene.CodeGen.Cli.Core`'s `benzene build`/`ClientCodeBuilder`,
 * scoped to the Contract Document input path (contract-document.md); flag names/shape are this port's
 * own idiom - contract-document.md §5.5 leaves CLI/file-layout details out of conformance scope.
 *
 * ```
 * codegen-client --file <path.spec.json> --output <client|topic-client> --namespace <dir>
 *                 [--service-name <name>] [--topics a,b,c] [--include-reserved] [--out <dir>]
 * ```
 *
 * Exits non-zero (message on stderr) on an unknown flag, an unparseable/invalid document, or a
 * `--topics` entry the document doesn't have - see `run()`, which is also called directly (not just
 * via the process entry point below) by this package's CLI tests.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { AtomicClientSdkOptions, buildAtomicClientSdk } from './AtomicClientSdkBuilder';
import { ContractDocumentParseError, parseContractDocument } from './ContractDocumentParser';
import { GeneratedClient, MessageClientSdkOptions, buildMessageClientSdk } from './MessageClientSdkBuilder';
import { UnknownTopicsError } from './TopicScope';

const OUTPUT_VALUES = ['client', 'topic-client'] as const;
type OutputValue = (typeof OUTPUT_VALUES)[number];

const FLAGS_WITH_VALUES = ['--file', '--output', '--namespace', '--service-name', '--topics', '--out'] as const;
const BOOLEAN_FLAGS = ['--include-reserved'] as const;
const KNOWN_FLAGS = new Set<string>([...FLAGS_WITH_VALUES, ...BOOLEAN_FLAGS]);

/** Thrown for any CLI-level failure (bad flags, bad document, unknown topic) - `run()`'s caller maps this to a non-zero exit. */
export class CliError extends Error {}

interface ParsedArgs {
  file?: string;
  output?: string;
  namespace?: string;
  serviceName?: string;
  topics?: string;
  includeReserved: boolean;
  out?: string;
}

/** Parses `argv` (excluding `node`/script path). Throws `CliError` on an unknown flag or a flag missing its value. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = { includeReserved: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (!KNOWN_FLAGS.has(flag)) {
      throw new CliError(`Unknown flag '${flag}'. Known flags: ${[...KNOWN_FLAGS].sort().join(', ')}.`);
    }

    if ((BOOLEAN_FLAGS as readonly string[]).includes(flag)) {
      args.includeReserved = true;
      continue;
    }

    const value = argv[++i];
    if (value === undefined) {
      throw new CliError(`'${flag}' requires a value`);
    }
    switch (flag) {
      case '--file':
        args.file = value;
        break;
      case '--output':
        args.output = value;
        break;
      case '--namespace':
        args.namespace = value;
        break;
      case '--service-name':
        args.serviceName = value;
        break;
      case '--topics':
        args.topics = value;
        break;
      case '--out':
        args.out = value;
        break;
    }
  }

  return args;
}

function requireOutput(value: string | undefined): OutputValue {
  if (value === undefined) {
    throw new CliError("'--output' is required");
  }
  if (!(OUTPUT_VALUES as readonly string[]).includes(value)) {
    throw new CliError(`Unknown --output '${value}'. Valid values: ${OUTPUT_VALUES.join(', ')}.`);
  }
  return value as OutputValue;
}

/** Runs the CLI end-to-end (parse args, read + parse the document, generate, write files). */
export async function run(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);

  if (args.file === undefined) {
    throw new CliError("'--file' is required");
  }
  if (args.namespace === undefined) {
    throw new CliError("'--namespace' is required");
  }
  assertSafeNamespace(args.namespace);
  const output = requireOutput(args.output);

  let json: string;
  try {
    json = await readFile(args.file, 'utf8');
  } catch (error) {
    throw new CliError(`--file '${args.file}' could not be read: ${(error as Error).message}`);
  }

  let document;
  try {
    document = parseContractDocument(json);
  } catch (error) {
    if (error instanceof ContractDocumentParseError) {
      throw new CliError(error.message);
    }
    throw error;
  }

  const topics =
    args.topics !== undefined && args.topics.trim() !== ''
      ? args.topics
          .split(',')
          .map((topic) => topic.trim())
          .filter((topic) => topic.length > 0)
      : undefined;

  let files: readonly GeneratedClient[];
  try {
    if (output === 'client') {
      const options: MessageClientSdkOptions = {
        serviceName: args.serviceName,
        namespace: args.namespace,
        topics,
        includeReserved: args.includeReserved,
      };
      files = [buildMessageClientSdk(document, options)];
    } else {
      const options: AtomicClientSdkOptions = {
        serviceName: args.serviceName,
        namespace: args.namespace,
        topics,
        includeReserved: args.includeReserved,
      };
      files = buildAtomicClientSdk(document, options);
    }
  } catch (error) {
    if (error instanceof UnknownTopicsError) {
      throw new CliError(error.message);
    }
    throw error;
  }

  await writeGeneratedFiles(args.out ?? process.cwd(), files);

  console.log(`${files.length} code file(s) created`);
  console.log('Completed');
}

/**
 * Rejects a `--namespace` that is absolute or whose normalized form escapes the output directory
 * (`..`-leading), BEFORE any generation happens — the namespace is spliced into every generated file
 * name (`namespacedFileName`), so a traversal here is a traversal in every write. A benign internal
 * `a/../b` (normalizing inside) is allowed. Port of the .NET R18 #292 WP-A ruling's containment,
 * applied to the one raw path component the CLI splices in itself.
 */
function assertSafeNamespace(namespace: string): void {
  if (isAbsolute(namespace)) {
    throw new CliError(`--namespace '${namespace}' must be a relative path inside the output directory`);
  }
  const normalized = normalize(namespace);
  if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
    throw new CliError(`--namespace '${namespace}' escapes the output directory`);
  }
}

/**
 * Writes the generated files under `outDir`, containing every write to it: an absolute `fileName` is
 * rejected outright, and each target is fully resolved and required to sit strictly inside the
 * resolved `outDir` (prefix check with a trailing path separator, so `/out` does not "contain"
 * `/outside`). Nothing is written if any file fails the check. Nested file names (topic-client mode's
 * per-client folders) remain supported. Port of the .NET R18 #292 WP-A ruling (`CodeFileWriter`
 * containment); the document-derived stems are already sanitized by the builders
 * (`toIdentifierSegment`) — this is the belt to that braces, so a hostile fetched `.spec.json`
 * cannot write outside `--out` even if stem sanitization regresses.
 */
export async function writeGeneratedFiles(outDir: string, files: readonly GeneratedClient[]): Promise<void> {
  const root = resolve(outDir);
  const targets = files.map((file) => {
    if (isAbsolute(file.fileName)) {
      throw new CliError(`Generated file name '${file.fileName}' must be relative to the output directory`);
    }
    const target = resolve(root, file.fileName);
    if (!target.startsWith(root + sep)) {
      throw new CliError(`Generated file name '${file.fileName}' escapes the output directory`);
    }
    return target;
  });

  for (let i = 0; i < files.length; i++) {
    const target = targets[i]!;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, files[i]!.source, 'utf8');
  }
}

// Only run the process entry point when this file is the one `node` was invoked on directly - not
// when a test imports `run`/`parseArgs` to exercise the CLI in-process. `require.main === module`
// is the CommonJS-native check (see the README's Porting-conventions table: this build compiles to
// CommonJS, so `import.meta` - ESM-only - is unavailable, unlike the equivalent .NET entry point).
if (require.main === module) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof CliError ? error.message : (error as Error).stack ?? String(error));
    process.exitCode = 1;
  });
}
