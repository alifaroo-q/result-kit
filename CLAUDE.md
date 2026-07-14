# result-kit workspace instructions

## Overview

- Package name: `@zireal/result-kit`
- Runtime target: Node.js 20+
- Package type: ESM-first library build with ESM and CJS outputs
- Primary reference docs: [README.md](README.md), [examples/core.ts](examples/core.ts), [examples/nest.ts](examples/nest.ts)

## Commands

- Install dependencies: `pnpm install`
- Build the package: `pnpm build`
- Run tests once: `pnpm test`
- Run coverage: `pnpm test:cov`
- Run type checking: `pnpm check`
- Clean build artifacts: `pnpm clean`

## Architecture

- [src/index.ts](src/index.ts) re-exports the framework-agnostic core only.
- [src/core/index.ts](src/core/index.ts) is the main library surface for `Result`, `TypedError`, and `ResultKit`.
- [src/nest/index.ts](src/nest/index.ts) contains the optional NestJS adapter layer.
- Keep NestJS-specific logic out of `src/core`.
- If you add a new public entrypoint, update [tsdown.config.ts](tsdown.config.ts) and package exports together.

## Coding Guidance

- Prefer the existing `ResultKit.success(...)` and `ResultKit.fail(...)` helpers over ad hoc result object construction.
- Keep typed error shapes aligned with the existing `type` and `message` convention used throughout the package.
- Preserve the package split between core utilities and transport or framework adapters.
- Mirror source changes with tests under [test/core](test/core) or [test/nest](test/nest) as appropriate.

## Verification

- Run `pnpm test` and `pnpm check` after TypeScript changes.
- Run `pnpm build` when changing public exports, packaging, or release-related files.

## Release Guidance

- For any consumer-facing bug fix, feature, or breaking change, add a changeset before finishing the work.
- Use `pnpm changeset` to create the changeset file.
- Choose the version bump based on impact:
  - `patch` for bug fixes and backward-compatible corrections
  - `minor` for backward-compatible features
  - `major` for breaking changes
- Internal-only changes that do not affect published package consumers usually do not need a changeset unless the user explicitly asks for one.
- Use `pnpm changeset:version` to apply release bumps and `pnpm changeset:publish` for publishing workflows.

## Documentation

- Link to [README.md](README.md) for installation, API surface, and usage guidance instead of duplicating large sections here.
- Use [examples/core.ts](examples/core.ts) and [examples/nest.ts](examples/nest.ts) as the canonical implementation examples.
