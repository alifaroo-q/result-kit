---
description: "Prepare a publishable result-kit change by selecting the correct patch, minor, or major bump, creating a changeset, and verifying entrypoints plus build output."
name: "Prepare Release Change"
argument-hint: "Describe the change being prepared for release"
agent: "agent"
---

Prepare this result-kit change for release: ${input:Describe the change being prepared for release}

> **During the v5 rework, add no changesets — skip steps 3 and 4.** Spec §8.2 overrides
> the changeset rule for the `5.0.0` release only: `package.json` still declares the burned
> `1.2.0`, so a `major` changeset computes `2.0.0` and `changeset publish` **403s**. #32
> hand-sets `5.0.0` and hand-writes the changelog. Resume this workflow in full from
> `5.0.1` / `5.1.0` onward.

Follow this workflow:

1. Inspect the current workspace changes and determine whether the published impact is `patch`, `minor`, or `major`.
2. Explain the version bump choice in terms of consumer impact.
3. If the change is consumer-facing, create a changeset with `pnpm changeset` using the selected bump type.
4. If the change is internal-only, state why a changeset is not needed instead of creating one.
5. Verify package entrypoints and exports remain consistent across [src/index.ts](../../src/index.ts), [tsdown.config.ts](../../tsdown.config.ts), and [package.json](../../package.json). Note that `exports` is **hand-authored** (`exports: false` in tsdown) — see [CLAUDE.md](../../CLAUDE.md)'s Architecture section for why.
6. Run `pnpm test` and `pnpm check`.
7. Run `pnpm build` when public exports, packaging, or release-facing files changed.
8. Summarize what was verified, what changeset was created, and any remaining release risks.

Keep the release preparation focused. Do not make unrelated code changes while performing this prompt.
