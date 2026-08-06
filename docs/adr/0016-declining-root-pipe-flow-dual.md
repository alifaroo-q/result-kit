# ADR 0016 — declining root `pipe`, `flow`, and `dual`

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Ali Farooq
- **Ticket:** [ADR: adopt root pipe? Whether and shape — reversing a v5 cut](https://github.com/alifaroo-q/result-kit/issues/88)
- **Evidence:** [Spike: pipe ergonomics](https://github.com/alifaroo-q/result-kit/issues/87) — `spikes/effect-gen-comparison/FINDINGS.md` Part 2 (F9–F13), experiments `07`–`09`
- **Builds on:** [ADR 0001 — the core API paradigm](./0001-v2-core-api-paradigm.md) (data-first free functions), [ADR 0006 — package layout and entrypoints](./0006-v2-package-layout-entrypoints.md) (`/fluent` as the opt-in chaining surface), [ADR 0007 — the do-notation helper](./0007-v2-do-notation-helper.md) (`safeTry`)
- **Spec touchpoints:** §4 (positioning: `/fluent` as hero, free-function core as the lean path), §5.9 (the root export list), §8.3 (the `MIGRATION.md` cut table)

## Context

Spec §8.3 cut v1's `pipe` / `pipeAsync` along with the `ResultPipeline` / `AsyncResultPipeline` classes, in one migration-table row, with `/fluent` or `safeTry` named as the replacement and the crossing labelled *a per-site design call, not a substitution*. CONTEXT.md records the same split in vocabulary terms: "pipeline" named both the class *and* the composition helper, which were different things.

That one-row framing is what made the question re-openable. Effect ships a `pipe` that is not a class at all — a variadic left-to-right apply, `pipe(a, f, g)` ≡ `g(f(a))` — and reads extremely well:

```ts
pipe(xs, Array.map(double), Array.filter(gt4))
```

So the honest question this ADR answers is not "was the v5 cut right?" — the classes are gone and nobody is asking for them back. It is: **does a bare variadic `pipe`, which was never really what §8.3 cut, earn a seat in the root barrel now?** [#87](https://github.com/alifaroo-q/result-kit/issues/87) built one (a 9-arity tower modelled on `effect@4.0.0-beta.104`'s `Function.ts`) and measured it against `/fluent`, `safeTry`, and nested free functions across three realistic call-sites, on the Ok, early-`Err` and late-`Err` branches.

## Decision

**No root `pipe`. No `flow`. No `dual`.** The data-last composition family is declined as a whole, and this document is where that stays recorded.

### 1. `pipe` — declined

Four findings, in the order they matter:

**The premise does not transfer (F9).** Effect's `pipe` reads well because `dual` ships a data-last double of every combinator, so `Array.map(double)` *is* a unary function and drops in naked. This package has no `dual` (§3 below), so every step is a bare lambda:

```ts
pipe(xs, Array.map(double), Array.filter(gt4))            // Effect
pipe(r,  (r) => map(r, double), (r) => andThen(r, gt4))   // ours
```

The ergonomic gain under evaluation is therefore Effect's *minus the mechanism that produced it*. Every measurement below is downstream of this one fact.

**It is the longest spelling at every call-site (F10).** Measured, not asserted — non-comment lines, whitespace-collapsed characters, pipeline lambdas, max indentation:

| call-site | `pipe` | `/fluent` | `safeTry` | nested |
| --- | ---: | ---: | ---: | ---: |
| **A** sync, error-widening (3 steps) | 115 ch, 2 λ | **103 ch, 0 λ** | 193 ch | 88 ch |
| **B** sync→async seam | 173 ch, 4 λ | 138 ch, 0 λ | 269 ch | **132 ch** |
| **C** 7 steps + recovery + terminal | 336 ch, 8 λ | **255 ch, 0 λ** | 462 ch | 264 ch, indent 12 |

`pipe` is never the shortest and never the flattest-with-fewest-lambdas. Its one genuine win is over the **nested** form at length — call-site C nests to indent 12 and must be read inside-out, where `pipe` stays at 4 and reads top-to-bottom. But `/fluent` already holds that win, *and* is shorter, *and* costs zero lambdas. So `pipe`'s advantage exists only against a form the package does not recommend at that length, and only for callers who have declined the hero surface.

**The one place that needs a name doesn't get one (F11).** `/fluent` spells the sync→async crossing `.toAsync()` — §10.9's rule made explicit and greppable. The `pipe` equivalent is `(r) => Promise.resolve(r)`, an unannotated lambda that reads like a no-op to anyone who does not already know the rule. The one place the design wants a reader to stop and think is the one place a pipeline has no vocabulary for.

**Nothing is unsafe (F12) — which is why this is purely a scope call.** §10.9 survives untouched: `pipe(parse(x), (r) => andThen(r, asyncStep))` is still a compile error, because the lambda body is a direct `andThen` call enforcing its own overloads. `pipe` can neither strengthen nor weaken the rule. Diagnostics are not worsened either; the same mistake reports the same message with and without it. There is no safety objection to overcome. `pipe` simply doesn't buy anything the shipped surfaces don't already have.

**The residual case, stated fairly and then rejected.** The spike left one argument standing: a **lean-path caller** — no `/fluent`, for bundle reasons — writing a long chain dominated by `orElse` / `mapErr` / terminals. That is the one shape `safeTry` handles awkwardly, since recovery is not a step *inside* a do-block but a construct *wrapping* one. For that caller the real choice is `pipe` (flat, 8 lambdas) versus nested (indent 12, inside-out).

Rejected on two grounds. First, §4's "lean path" means **fewer exports**, not a composition combinator: a caller who declined `/fluent` over bundle size is the caller least likely to want another root export in their graph, and `pipe`'s tower is not free. Second, §8.3 already told every v1 migrant that `pipe` is a per-site design call between the wrapper and `safeTry`; adopting now would make shipped migration advice retroactively wrong for a caller whose existence is hypothesised rather than observed.

### 2. `flow` — declined unconditionally

Declined **whatever `pipe` had ruled**, which is why it needed no separate decision. With no data-last combinators there is nothing point-free to compose: every step after the first must be a lambda, and a step factored out for reuse must be *fully annotated*, because there is no contextual type off-site (`const step = (r) => map(r, label)` is an implicit `any`). So `flow(f, g)` and `(x) => pipe(f(x), g)` are the same type and the same work — pinned in the spike by `expectTypeOf(viaFlow).toEqualTypeOf<typeof viaPipe>()`. Its entire residual claim is nine characters and the ability to start from a multi-argument function.

### 3. `dual` — declined, and recorded here rather than in a coordination artifact

`dual` is the load-bearing one. F9 makes it *the* reason `pipe` doesn't transfer, so a decision that declined `pipe` without recording why would invite exactly one reply — "then let's add `dual` and re-open `pipe`" — with no permanent document to point at. It is declined for its own reasons, which stand independently:

- It would **unteach the data-first rule** that `llms.txt` and `llms-full.txt` teach as the package's identity. Every combinator would acquire a second legal spelling, and both briefs would have to present both.
- Its mechanism is **runtime arity detection** — inspecting `arguments.length` to decide whether the caller meant data-first or data-last. That is a hack in a package whose §2 union is deliberately brandless and structural.
- It doubles the overload surface of every §5.2 transform, in a package where §10.9's `SettledOr` typing already makes those overloads the subtlest thing in the codebase.

**The composition family is declined as a unit.** `pipe` without `dual` doesn't pay; `dual` is declined on its own merits; `flow` needs `dual` even more than `pipe` does. Re-opening any one of them means re-opening `dual` first, and that is the argument to have.

## Consequences

- **Nothing ships.** No new root export, no §5.9 change, no `llms.txt` / `llms-full.txt` entry, no README change, no changeset — this decision is a no-op on the published surface, which is the point. The `/writing-plans` handoff inherits nothing from it.
- **Spec §8.3 gets one clarifying sentence**, distinguishing the composition helper from the wrapper classes and pointing here. The row itself stays correct; the blur is what made the question re-openable, and CONTEXT.md:95 already draws the line the spec was collapsing.
- **CONTEXT.md is unchanged** — its "pipeline" entry already says `pipe` has no direct replacement and is a per-site design call. This ADR is the *why* behind a sentence that was already true.
- **`/fluent` keeps its position unopposed.** F10 measured it as the shortest and flattest spelling at two of three call-sites and the only zero-lambda one at all three, which is §4's hero positioning confirmed rather than assumed.
- **The reversal condition is explicit.** If `dual` is ever reconsidered, `pipe` should be reconsidered with it — F9 is the whole hinge, and the F10 measurements are void the moment naked steps become possible. Absent that, this is closed.
