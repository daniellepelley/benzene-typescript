import { defineConfig } from 'vitest/config';

// Config used ONLY to verify a generated sample project (see verify.mjs). Passed explicitly with
// `--config` + `--root <generated-project>`, so vitest does not walk up and pick the repo's own
// vitest.config.ts (which excludes create-benzene/**). `include` is relative to the --root project.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
