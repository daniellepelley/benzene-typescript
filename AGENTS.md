# Benzene TypeScript — Project Guide for AI Coding Agents

## What this is
The TypeScript port of [Benzene](https://github.com/daniellepelley/benzene), a middleware-based
library supporting hexagonal (ports-and-adapters) architecture. The port must match the .NET
original as closely as the language allows — same layout, same type and file names, tests
ported from the C# suite.

## Golden rule
When adding or changing anything, read the corresponding C# code in the .NET repository first
and port it, rather than designing from scratch. Apply the mapping rules in the README's
"Porting conventions" section exactly; if a new rule is needed, add it there in the same style.

## Structure
- `src/<Benzene.PackageName>/` — one npm workspace package per C# project, files named after
  their `.cs` counterparts
- `test/Benzene.Core.Test/` — vitest tests mirroring the C# test layout and scenarios
- Root `package.json` — npm workspaces; `tsconfig.json` covers all packages

## Dev environment
- Node 22+, npm workspaces
- `npm run build` — typecheck everything (`tsc --noEmit`)
- `npm test` — run the vitest suite
- Run both before considering a task complete

## Conventions
- Strict TypeScript, ESM, no runtime dependencies outside the workspace — EXCEPT third-party
  adapter packages (see next bullet), which depend on the library they adapt
- Interfaces keep the C# `I` prefix and declare a merged `ServiceToken` constant when they are
  resolved from the container
- C# extension methods → base-class members (fluent builders) or free functions (everything
  else); see README for the full mapping table
- **Third-party integrations are adapted, not reimplemented.** When a .NET package exists only to
  wrap a third-party library (DataAnnotations, FluentValidation, Autofac, ...), keep the shared
  abstraction core and aligned, but re-create the integration against the popular JavaScript-
  ecosystem equivalent(s) — one adapter package per library (e.g. `@benzene/zod`, `@benzene/joi`,
  `@benzene/yup`), each mirroring the integration's shape. Pick the 2–3 most-used equivalents; skip
  little-used ones. See the README "Third-party library integrations" convention for detail.

## Do NOT
- Do not introduce third-party runtime dependencies without asking first
- Do not diverge from the C# naming or file layout without documenting the reason in the README
- Do not change public API signatures on ported types without flagging it as a breaking change
- Do not skip or disable existing tests to make a build pass
