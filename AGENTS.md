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

The balance between porting .NET faithfully and landing on an idiomatic TypeScript shape is owned by
the **`typescript-dx-champion`** agent (`.claude/agents/typescript-dx-champion.md`) — invoke it to
review a newly ported package for TS-naturalness, or to decide when a literal port should bend toward a
TS idiom (and how to document the bend). Faithful by default; bend when fidelity would produce something
a TS developer would never write; record every bend in the README "Porting conventions" table.

## Documentation
Documentation written **in this repo is for the TypeScript community**: idiomatic TypeScript, the
real `@benzene/*` npm packages, ESM imports, `vitest` — the concrete "how to build, host, test, and
operate a Benzene service in TypeScript". Write it the way a TypeScript developer expects to read it
(not as a transliteration of the C# prose).

Do **not** restate the language-neutral material here. The concepts, wire contracts, status
vocabulary, mesh shapes, and the Cloud Service Profile are defined once, for every language, in the
cross-language [benzene](https://github.com/daniellepelley/Benzene/tree/main/docs/specification)
repo. **Link to the spec; don't duplicate it.** If you're writing something that is true for every
port rather than a TypeScript idiom, it's a spec/guide change in the benzene repo — raise it there.
The website lets a reader pick their language and get the TypeScript docs from this repo, alongside
the shared spec.

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
