# ADR 0013 — Lint port scope: which linters ship `must-use-result` in round one

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: Oxlint and Biome port scope — is a syntax-tier rule worth shipping?](https://github.com/alifaroo-q/result-kit/issues/74)
- **Gates:** [Lint enforcement #60](https://github.com/alifaroo-q/result-kit/issues/60) (round-one scope)
- **Feeds:** [Decide: peer-dependency policy and lint-package layout #71](https://github.com/alifaroo-q/result-kit/issues/71) (monorepo argument)
- **Evidence:** [`must-use-result` feasibility research](../research/must-use-result-linter-feasibility.md) (#70) and the [shared-source spike](../research/oxlint-eslint-shared-rule-spike.md) (#74 Q2). Findings below are measured or documented, not predicted.

## Context

Session-1 planned three delivery vehicles — ESLint, Oxlint, Biome — for one `must-use-result` vocabulary, sized against the assumption that the Oxlint and Biome ports would reach a lower-but-useful tier. The feasibility research (#70) replaced that assumption: **neither Oxlint nor Biome lets a third-party rule see types.** Without types a rule cannot tell a `Result`-returning call from a `void` one, so the syntax tier reaches little beyond direct calls to functions imported from `@zireal/result-kit` and locally-declared functions whose annotated return type textually mentions `Result`.

The shared-source spike (#74 Q2) then established that the Oxlint syntax-tier rule is a *re-export*, not a port: Oxlint's alpha JS-plugin API is a deliberate ESLint-v9 clone, so one `{ meta, create }` module serves both hosts. Biome has no equivalent leverage — GritQL plugins query the CST with no scope manager, so a Biome rule is a genuine separate port whose practical recall is *lower* than the ESTree tier (it cannot resolve an identifier back to its import binding).

This ADR settles two of #74's three questions — Q1 (does a syntax-tier rule earn a round-one release on either linter?) and Q3 (if deferred, what is the concrete revisit trigger?). Q2 (shared source file) is answered in the spike doc.

## The bar

A syntax-tier rule is shippable only if:

1. **(primary) its recall clears a floor** — measured on this repo's own `src/`, the same probe method the feasibility doc used, pointed at the *weaker* tier. A rule that silently green-lights files full of dropped `Result`s is worse than no rule, however it is labeled.
2. **(mandatory) its tier is stated plainly** — session-1's carried constraint: *never claim parity that isn't there.*

Recall is the primary gate; honesty labeling is a hard constraint on top, not a substitute for recall. "Ship" therefore means "ship **after** a recall probe clears the floor," not "ship on principle."

## Decision

**Round-one scope: ESLint (full tier), Oxlint (syntax tier, gated on the recall probe), Biome deferred.**

- **ESLint** — ships the full type-aware rule. The only full-fidelity host, the only stable plugin API (#70).
- **Oxlint** — ships the syntax tier **iff the recall probe clears the floor**. The floor is *the same* floor every syntax-tier rule faces. Q2's near-zero cost (shared source file) eases **packaging**, not the bar: a user running Oxlint does not care that the port was cheap, only whether the rule catches their dropped `Result`s, and the false-confidence cost of a low-recall rule does not shrink with how cheaply it was built. If the probe clears, the shared file makes shipping trivial.
- **Biome** — **deferred from round one, unconditionally.** It uniquely stacks the highest cost (a real GritQL port, no shared file), the lowest recall (CST pattern-matching with no scope manager — it cannot do import-provenance resolution, so its recall is a different and lower number than Oxlint's, requiring its own probe), and no upgrade path (the 2026 roadmap commits nothing). It fails the primary bar before the work starts, and the Oxlint probe result does not transfer to it.

### Revisit triggers (Q3)

Two triggers, one per linter, each a specific documented-capability flip rather than "when it matures":

- **Biome** → revisit when **Biome exposes its inference engine to third-party plugins** (type-aware plugin support). This flips both objections at once: it lifts Biome to the full type-aware tier (recall stops being the problem) *and* supplies the upgrade path the roadmap currently denies. Deliberately **not** "GritQL gains scope analysis" — that would only buy syntax-tier recall parity with Oxlint while leaving Biome with no path off the tier, re-opening the same weak question. Watch the Biome plugin docs / roadmap.
- **Oxlint** → revisit when Oxlint moves **"custom type-aware rules" out of "Not supported yet."** This upgrades Oxlint from syntax tier to full fidelity and applies in both branches: it revisits Oxlint if the probe failed and it was deferred, and it upgrades Oxlint to the real rule if the syntax tier already shipped. Watch the Oxlint type-aware-linting docs page.

## Consequences

- **#60 carries a new gating task: the syntax-tier recall probe.** Oxlint's ship/defer cannot be decided without it — it is the syntax-tier analogue of the feasibility doc's probe (Appendix A), run against this repo's own `src/` to measure how many real dropped-`Result` sites the import-provenance and return-type matchers actually catch. Below the floor, Oxlint defers to its trigger alongside Biome.
- **#60 also carries the TS-annotation spike test** from the Q2 spike: the "return type textually mentions `Result`" matcher reads TS annotation nodes, and Oxlint parses with oxc's own parser (not `@typescript-eslint/parser`), so that matcher needs an empirical parity check before the shared file is relied on for it. The import-provenance matcher is safe.
- **Round one is ESLint + (conditionally) Oxlint.** Every shipped package states its tier in its README; the Oxlint package, if it ships, states plainly that it is syntax-tier and names what it cannot see.
- **#71 gains confirmed evidence** for the monorepo layout: a genuinely shared ESLint/Oxlint rule source, not a hope.
- **Nothing here reverses.** If a trigger fires, the deferred linter is added additively; if the Oxlint probe fails, Oxlint waits for its trigger with Biome. The vocabulary is unchanged across all outcomes.
