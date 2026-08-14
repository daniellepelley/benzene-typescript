import { configDefaults, defineConfig } from 'vitest/config';
import { workspaceAliases } from './scripts/workspace-aliases.generated.mjs';

// The repo's own test suite lives under `test/**` (and a few `examples/**` example tests). The
// top-level `templates/<id>/` folders are STARTER TEMPLATES — vanilla projects `create-benzene`
// scaffolds — and each carries its own `*.test.ts` component test that is TEMPLATE CONTENT, meant to
// run inside a GENERATED project (verified separately by `create-benzene/scripts/verify.mjs`), not as
// part of this workspace's suite. Exclude both the templates and the `create-benzene/` CLI package so
// `npm test` stays scoped to the library's own tests. `.verify/` is the scratch output dir the verify
// script generates sample projects into.
//
// `resolve.alias` sends every `@benzenejs/*` import straight to its package's source `index.ts`
// (see scripts/sync-workspace-paths.mjs) rather than through the node_modules workspace symlink,
// which would otherwise resolve via that package's "main" field — now the compiled `dist/` output,
// built only for publishing. Without this, tests would need a full build before reflecting edits to
// a sibling package.
export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    exclude: [...configDefaults.exclude, 'templates/**', 'create-benzene/**', '**/.verify/**'],
  },
});
