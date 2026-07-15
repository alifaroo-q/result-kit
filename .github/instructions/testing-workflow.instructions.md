---
description: "Use when changing src/core or src/fluent in result-kit. Enforces Vitest test updates, coverage-minded changes, and required pnpm test plus pnpm check verification before finishing."
name: "Result Kit Testing Workflow"
applyTo: "src/core/**, src/fluent/**"
---

# Testing Workflow

- When you change code under `src/core` or `src/fluent`, add or update the matching Vitest coverage under `test/core` or `test/fluent` in the same task.
- Cover the behavior you changed, including success paths, failure paths, and any newly introduced edge cases.
- Keep tests aligned with the package split: free-function core behavior belongs in `test/core`, fluent wrapper behavior belongs in `test/fluent`.
- Before finishing, run `pnpm test` and `pnpm check` and confirm the outcome from command output.
- **`pnpm test` alone does not assert types.** `vitest.config.ts` sets no `typecheck` config, so `expectTypeOf` is a runtime no-op under `vitest run` — a deliberately wrong assertion still passes. `pnpm check` (`tsc --noEmit`) is the assertion engine, and `@ts-expect-error` only bites there. Treat work as green only when **both** pass.
- If the change affects public exports, packaging, or release behavior, also run `pnpm build`.
- Prefer focused test additions over broad rewrites of unrelated specs.
