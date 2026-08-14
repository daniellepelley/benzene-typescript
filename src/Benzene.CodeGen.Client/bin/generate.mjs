#!/usr/bin/env node
// The `codegen-client` executable (package.json "bin"). This package publishes compiled CommonJS
// (see scripts/build.mjs), so this .mjs shim - which Node always loads as ESM regardless of the
// package's own "type" - `require`s the compiled ../Cli.js sibling directly, the same dist/ output
// every other consumer of this package resolves through "main"/"types".
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { run, CliError } = require('../Cli.js');

run(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof CliError ? error.message : (error.stack ?? String(error)));
  process.exitCode = 1;
});
