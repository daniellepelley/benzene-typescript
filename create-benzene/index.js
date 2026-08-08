#!/usr/bin/env node
// create-benzene — scaffolds a new Benzene TypeScript service from a bundled starter template.
//
// The Node/TypeScript counterpart of the .NET `dotnet new benzene.*` template pack: `npm create
// benzene@latest my-service --template aws-sqs` copies one of the `templates/<id>/` directories that
// ship inside this package into a new project directory, fills in the project name, and prints the
// next steps. This mirrors the proven `create-vite` approach (bundle template dirs, copy one) and
// deliberately has ZERO runtime dependencies — only Node built-ins — so `npm create` needs no install.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The starter templates live in the repo's top-level `templates/` folder — one home, consistent with
// the .NET (`templates/`), Go (`templates/`) and Python (`templates/`) ports. This CLI is their
// consumer, not their owner. Two resolutions cover both worlds:
//   - In the repo (dev, `verify.mjs`, `npm create` from a checkout): use the sibling `../templates`.
//   - In the published npm tarball: `prepack` (see package.json) copies that folder to `./templates`
//     so the package is self-contained, since npm can't ship files from outside the package dir.
// Prefer the bundled copy when present (published), else the canonical top-level folder (in-repo).
const BUNDLED_TEMPLATES_DIR = path.join(__dirname, 'templates');
const REPO_TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const TEMPLATES_DIR = fs.existsSync(BUNDLED_TEMPLATES_DIR) ? BUNDLED_TEMPLATES_DIR : REPO_TEMPLATES_DIR;

// The token every template file uses where the generated project's npm package name should appear.
const PROJECT_NAME_TOKEN = '__PROJECT_NAME__';

// devDependencies + scripts that only exist for the optional component-test project, pruned by --no-tests.
const TEST_DEV_DEPENDENCIES = ['vitest', '@benzene/testing', '@benzene/aws-lambda-testing'];

// Text file extensions that get token substitution on copy (everything else is copied byte-for-byte).
const TEXT_EXTENSIONS = new Set(['.json', '.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.yaml', '.yml', '.txt']);

/** One entry per bundled template — id (the --template value / directory name) + a one-line label. */
const TEMPLATES = [
  { id: 'aws-apigateway', label: 'AWS Lambda + API Gateway (HTTP, request/response)' },
  { id: 'aws-sqs', label: 'AWS Lambda + SQS (queue consumer, fire-and-forget)' },
];

function discoverTemplates() {
  // The declared list is the source of truth for ordering/labels; keep only the ones present on disk.
  return TEMPLATES.filter((t) => fs.existsSync(path.join(TEMPLATES_DIR, t.id)));
}

function printHelp() {
  const templates = discoverTemplates();
  console.log(`
create-benzene — scaffold a new Benzene TypeScript service

Usage
  npm create benzene@latest <project-directory> -- --template <id>
  npx create-benzene <project-directory> --template <id>

Arguments
  <project-directory>   Directory to create the project in (also the default package name).

Options
  -t, --template <id>   Starter template to use (see below). Prompted for if omitted.
      --no-tests        Skip the component-test project (vitest + @benzene/*-testing).
      --overwrite       Allow generating into a non-empty directory.
  -h, --help            Show this help.

Templates
${templates.map((t) => `  ${t.id.padEnd(16)} ${t.label}`).join('\n')}

Example
  npm create benzene@latest my-service -- --template aws-sqs
`);
}

function parseArgs(argv) {
  const options = { projectDir: undefined, template: undefined, tests: true, overwrite: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-t' || arg === '--template') {
      options.template = argv[++i];
    } else if (arg.startsWith('--template=')) {
      options.template = arg.slice('--template='.length);
    } else if (arg === '--no-tests') {
      options.tests = false;
    } else if (arg === '--tests') {
      options.tests = true;
    } else if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.projectDir === undefined) {
      options.projectDir = arg;
    }
  }
  return options;
}

function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (query) => new Promise((resolve) => rl.question(query, resolve));
  return { question, close: () => rl.close() };
}

/** Turns a directory name/path into a valid npm package name (lowercase, url-safe). */
function toPackageName(projectDir) {
  const base = path.basename(path.resolve(projectDir));
  const name = base
    .trim()
    .toLowerCase()
    .replace(/^[._]+/, '')
    .replace(/[^a-z0-9-~]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name || 'benzene-service';
}

function isEmptyDir(dir) {
  if (!fs.existsSync(dir)) return true;
  const entries = fs.readdirSync(dir);
  return entries.length === 0 || (entries.length === 1 && entries[0] === '.git');
}

/** Recursively copies a template directory, applying token substitution, `_gitignore` renaming and --no-tests pruning. */
function copyTemplate(srcDir, destDir, { projectName, includeTests }) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    // The test project is a single `test/` directory; --no-tests drops it wholesale.
    if (!includeTests && entry.isDirectory() && entry.name === 'test') continue;

    const srcPath = path.join(srcDir, entry.name);
    // npm strips a real `.gitignore` from a published package, so templates ship it as `_gitignore`.
    const destName = entry.name === '_gitignore' ? '.gitignore' : entry.name;
    const destPath = path.join(destDir, destName);

    if (entry.isDirectory()) {
      copyTemplate(srcPath, destPath, { projectName, includeTests });
      continue;
    }

    if (destName === 'package.json') {
      writePackageJson(srcPath, destPath, { projectName, includeTests });
      continue;
    }

    if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      const content = fs.readFileSync(srcPath, 'utf8').split(PROJECT_NAME_TOKEN).join(projectName);
      fs.writeFileSync(destPath, content);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Writes the generated package.json: sets the name, and (when --no-tests) prunes the test script + test devDeps. */
function writePackageJson(srcPath, destPath, { projectName, includeTests }) {
  const pkg = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  pkg.name = projectName;

  if (!includeTests) {
    if (pkg.scripts) delete pkg.scripts.test;
    if (pkg.devDependencies) {
      for (const dep of TEST_DEV_DEPENDENCIES) delete pkg.devDependencies[dep];
      if (Object.keys(pkg.devDependencies).length === 0) delete pkg.devDependencies;
    }
  }

  fs.writeFileSync(destPath, JSON.stringify(pkg, null, 2) + '\n');
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const templates = discoverTemplates();
  if (templates.length === 0) {
    throw new Error(`No templates found in ${TEMPLATES_DIR}`);
  }

  const prompt = createPrompt();
  try {
    // 1. Project directory
    let projectDir = options.projectDir;
    if (!projectDir) {
      projectDir = (await prompt.question('Project directory (e.g. my-service): ')).trim();
    }
    if (!projectDir) throw new Error('A project directory is required.');

    // 2. Template
    let templateId = options.template;
    if (!templateId) {
      console.log('\nAvailable templates:');
      templates.forEach((t, i) => console.log(`  ${i + 1}) ${t.id.padEnd(16)} ${t.label}`));
      const answer = (await prompt.question(`\nTemplate [1-${templates.length}] (default 1): `)).trim();
      const index = answer === '' ? 0 : Number.parseInt(answer, 10) - 1;
      if (Number.isNaN(index) || index < 0 || index >= templates.length) {
        throw new Error(`Invalid template selection: ${answer}`);
      }
      templateId = templates[index].id;
    }
    if (!templates.some((t) => t.id === templateId)) {
      throw new Error(`Unknown template "${templateId}". Choose one of: ${templates.map((t) => t.id).join(', ')}`);
    }

    // 3. Target directory checks
    const destDir = path.resolve(projectDir);
    if (!options.overwrite && !isEmptyDir(destDir)) {
      throw new Error(`Target directory "${projectDir}" is not empty. Use --overwrite to generate into it anyway.`);
    }

    const projectName = toPackageName(projectDir);
    const srcDir = path.join(TEMPLATES_DIR, templateId);
    copyTemplate(srcDir, destDir, { projectName, includeTests: options.tests });

    printNextSteps({ projectDir, projectName, templateId, includeTests: options.tests });
  } finally {
    prompt.close();
  }
}

function printNextSteps({ projectDir, projectName, templateId, includeTests }) {
  const rel = path.relative(process.cwd(), path.resolve(projectDir)) || '.';
  console.log(`
Created a Benzene "${templateId}" service in ${rel} (package "${projectName}").

Next steps:
  cd ${rel}
  npm install${includeTests ? '\n  npm test        # run the component test' : ''}
  npm run build   # typecheck

Note: the generated package.json references the real @benzene/* npm packages. Until those are
published to the registry, install/build/test resolve them locally (see the project README).
`);
}

run().catch((error) => {
  console.error(`\nError: ${error.message}\n`);
  process.exit(1);
});
