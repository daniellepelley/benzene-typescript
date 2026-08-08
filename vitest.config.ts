import { configDefaults, defineConfig } from 'vitest/config';

// The repo's own test suite lives under `test/**` (and a few `examples/**` example tests). The
// `create-benzene/` package bundles complete starter projects as `templates/<id>/` — those carry their
// own `*.test.ts` component tests that are TEMPLATE CONTENT, meant to run inside a GENERATED project
// (verified separately by `create-benzene/scripts/verify.mjs`), not as part of this workspace's suite.
// Exclude them here so `npm test` stays scoped to the library's own tests. `.verify/` is the scratch
// output dir the verify script generates sample projects into.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'create-benzene/**', '**/.verify/**'],
  },
});
