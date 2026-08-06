# Effect.gen comparison spike — findings

**Question.** Our `safeTry` / `safeUnwrap` borrow the generator-do-notation
concept `Effect.gen` popularized. Is ours robust, type-safe, and defect-free
against the edge cases Effect has already met — and which of their solved
footguns should we adopt?

**Method.** Effect `4.0.0-beta.104` is vendored here as a dev-only dependency
(this package is `private`, ignored by the root build/test/typecheck/tarball;
`.npmignore` is deny-all, root vitest never collects `*.spike.ts`). Their
implementation and test suite were read at the matching tag
(`Effect-TS/effect@effect@4.0.0-beta.104` — `packages/effect/src/internal/effect.ts`,
`fromIteratorUnsafe` / `fromIteratorEagerUnsafe`, and `packages/effect/test/Effect.test.ts`).
42 comparative experiments live in `experiments/*.spike.ts`.

Run: `pnpm install --ignore-workspace && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`

## Findings

### F1 — defect in ours, **found and fixed**: a `finally` that yields during close stranded the generator

`release` called `generator.return()` **once**. A `finally` containing its own
fallible cleanup step (`yield* safeUnwrap(close())`) re-suspends the generator
at that yield during close — the single `.return()` reported not-done, outer
`finally`s never ran, and the body was stranded mid-unwind: the exact
resource-leak class the #36 retro closed, one level down. Observed in
experiment 04A (`order: ['inner-finally']`, outer never ran).

**Fix**: `release` drives `.return()` until `done` (each call consumes at least
one suspension point on the unwind path, so it terminates for any real
generator body). First `Err` stays the answer — cleanup cannot re-route the
result, matching the rule that ignores a `finally`'s `return ok(...)` override
(F5). Pinned by four tests in `test/core/do-notation.spec.ts`
("safeTry unwinds a finally that itself yields during close"), proven red
against the pre-fix code (3 of 4 fail; the fourth pins the first-Err-wins
discard rule, which already held). Changeset: patch.

Effect cannot hit this bug because it never resumes a failed body at all —
which is F2, their bigger trade.

### F2 — Effect footgun we already avoid: `try/finally` in `Effect.gen` does not run on failure

Confirmed empirically (experiment 02) and in their driver: when a yielded
effect's exit is a Failure, `fromIteratorUnsafe` returns the failure and drops
the iterator — there is no `iterator.return()` anywhere in the file. A body's
`finally` runs on success and is **skipped on failure**; `catch` never sees the
failure either. Their prescribed tool is `Effect.ensuring` / `Scope`. Ours runs
every pending `finally`, innermost first, and the async caller's promise waits
for the full unwind. Keep this; it is a genuine robustness advantage of the
close-the-generator design, and it is what made F1 worth fixing rather than
documenting.

### F3 — language-inherited limitation, now documented in-source: async bodies assimilate a thenable-carrying `Result`

§2's union is brandless, so a structurally valid `Err` may carry a callable
`then`. Sync path: immune — delivered by identity, `then` never called
(`isSettledResult` asks Result-first; pinned in the root suite). Async path:
hijacked — async generators await what they yield and promises assimilate what
they resolve, so the `then`'s answer silently replaces the `Result`
(experiments 04C/04D: `{"hijack":true}` delivered, `then` called once). A
promise cannot resolve to a thenable *in principle*, so no runtime check can
fix delivery — same class as spec §10.7's never-settling builder. Effect is
immune only because its values are branded (never thenable-shaped), the trade
we declined to keep §2.1's JSON round trip. Recorded in `safeUnwrap`'s doc
comment as documented-not-fixed.

### F4 — deliberate design difference, behaves correctly: no defect channel

A throw in the body: Effect converts it to a third channel (`Die`). Ours
propagates loudly — synchronous throw from a sync body, rejection from an async
body — and pending `finally`s still run (experiment 03; the rejecting
`Promise<Result>` case likewise propagates and still cleans up). A throw from a
`finally` during close wins over the short-circuit `Err` (sync throws, async
rejects) — matching native `try { return } finally { throw }` semantics;
Effect's failing/throwing finalizer likewise replaces the exit. No change
needed; two channels is the package's design.

### F5 — parity confirmed: cleanup cannot override the result

A `finally` with `return ok(999)` during close is ignored; the short-circuit
`Err` is returned (experiment 04B). Consistent with F1's discard rule.

### F6 — inherent scale limits, characterized: sync-generator recursion depth

100k sequential unwraps in one body: fine (~200ms; Effect ~25ms — their yield
loop is tighter, ours allocates a `safeUnwrap` generator per step; not a
correctness issue). Nested `safeTry` depth: wall at ~15k (`RangeError`,
occasionally surfacing as a V8 `TypeError` under a vitest worker's smaller
stack budget); Effect runs 20k+ because its fiber runtime is heap-based. A
trampoline is an effect-system's price tag, not a Result library's — not
adopted.

### F7 — reuse semantics: their footgun is structurally impossible here

An `Effect` is a re-runnable description; a generator is single-shot — so their
eager gen must detect re-execution and re-create the iterator
(`isFirstExecution` in `fromIteratorEagerUnsafe`), and a mid-run re-execution
restarts the body's side effects from scratch. Our `safeTry` takes a thunk and
runs eagerly exactly once; re-running means calling again, which re-invokes the
thunk. Hand-driving a `safeUnwrap` generator past its short-circuit throws
(already pinned upstream, re-confirmed).

### F8 — type-level parity: same inference mechanism, one deliberate divergence

Effect's error channel uses the non-distributive `[Eff] extends [Effect<_, E, _>]`
trick over a whole-captured union — the same mechanism as our naked `Y`/`R`
plus distributive `ErrorOf`/`ValueOf`. Accumulation across steps, uninhabited
(`never`) channels, and the structural-alias collapse (a TS limitation, pinned
upstream) all behave identically (experiment 06, asserted by `tsc`). The
divergence: `Effect.gen` auto-wraps the bare returned value; ours requires an
explicit `return ok(v)` and rejects a bare value at the type level — kept, it
is what lets a body early-`return err(...)`, and auto-wrapping cannot
distinguish the two without a brand.

## Adoption summary

| Learning | Action |
| --- | --- |
| F1 stranded-unwind defect | **Fixed** in `src/core/do-notation.ts`, pinned by 4 tests, patch changeset |
| F2 finally-on-failure | Already better than Effect — kept, now evidence-backed |
| F3 async thenable assimilation | **Documented** in `safeUnwrap` doc comment as §10.7-class |
| F4/F5 defect + override semantics | Confirmed correct, no change |
| F6 depth wall, F7 reuse, F8 auto-wrap / Die channel / fiber trampoline | Deliberately not adopted, reasons above |

Root verification after the fix: `pnpm test` 1164/1164, `pnpm check` clean,
`pnpm build` clean (attw + publint pass), `npm pack --dry-run` ships no spike
files.

---

# Part 2 — `pipe` ergonomics (issue #87)

**Question.** Does a root `pipe` (Effect-style variadic apply — *not* the
deleted v1 `ResultPipeline`) earn its seat ergonomically? And what happens to
`flow`?

**Method.** A candidate `pipe` (9-arity tower) and `flow` (5-arity) built in
`experiments/07-pipe-candidate.spike.ts`, modelled on
`effect@4.0.0-beta.104` `packages/effect/src/Function.ts`. Three realistic
checkout call-sites — sync error-widening, a sync→async seam, and a
seven-step chain with recovery and a terminal — each written **four ways**
(`pipe` + bare lambdas, `/fluent`, `safeTry`, nested free functions) in
`08-pipe-call-sites.spike.ts`, with all four asserted to produce the same
value on the Ok, the early-Err and the late-Err branch. Type behaviour pinned
in `09-pipe-types.spike.ts` under the spike's own `tsc`, proven red against
both a wrong `expectTypeOf` and a removed `@ts-expect-error`.

## F9 — the premise does not transfer: without `dual`, every step is a lambda

Effect's `pipe` reads well because `dual` ships a data-last double of every
combinator, so `Array.map(double)` **is** a unary function and drops in naked:

```ts
pipe(xs, Array.map(double), Array.filter(gt4))     // Effect
pipe(r,  (r) => map(r, double), (r) => andThen(r, gt4))   // ours
```

`dual` is already out of scope on the map (it would unteach the data-first
rule the llms briefs teach as the package's identity, via a runtime
arity-detection hack). So the ergonomic gain being evaluated is not Effect's
— it is Effect's *minus* the mechanism that produced it. Every measurement
below is downstream of this one fact.

## F10 — measured: `pipe` is the longest spelling at every call-site

Non-comment lines, whitespace-collapsed characters, `(r) =>` pipeline lambdas,
and max indentation, from `08-pipe-call-sites.spike.ts`:

| call-site | spelling | lines | chars | lambdas | max indent |
| --- | --- | ---: | ---: | ---: | ---: |
| **A** sync, error-widening (3 steps) | `pipe` | 6 | 115 | 2 | 4 |
| | `/fluent` | 2 | **103** | 0 | 2 |
| | `safeTry` | 6 | 193 | 0 | 4 |
| | nested | 2 | **88** | 0 | 2 |
| **B** sync→async seam | `pipe` | 8 | 173 | 4 | 4 |
| | `/fluent` | 7 | 138 | 0 | 4 |
| | `safeTry` | 7 | 269 | 0 | 4 |
| | nested | 8 | **132** | 0 | 6 |
| **C** seven steps + recovery + terminal | `pipe` | 12 | 336 | 8 | 4 |
| | `/fluent` | 10 | **255** | 0 | 4 |
| | `safeTry` | 15 | 462 | 0 | 4 |
| | nested | 17 | 264 | 0 | **12** |

`pipe` is never the shortest and never the flattest-with-fewest-lambdas. Its
one real win is over the **nested** form at length: call-site C nests to
indent 12 and must be read inside-out, where `pipe` stays at 4 and reads
top-to-bottom. But `/fluent` already holds that win *and* is shorter *and*
costs zero lambdas — so `pipe`'s advantage exists only against a form the
package does not recommend for chains this long, and only for callers who
have refused the hero surface.

## F11 — the seam has no name in a pipeline

`/fluent` spells the sync→async crossing `.toAsync()` — §10.9's rule made
explicit and greppable. The `pipe` equivalent is:

```ts
(r) => Promise.resolve(r),   // ← the seam
```

an unannotated lambda that reads like a no-op to anyone who does not already
know the rule. Nothing is *unsound* — F12 — but the one place the design
wants a reader to stop and think is the one place a pipeline has no vocabulary
for.

## F12 — safety: `pipe` is fully neutral, on both soundness and diagnostics

Two things checked because they were the plausible objections, and both came
back clean:

- **§10.9 survives.** `pipe(parse(x), (r) => andThen(r, asyncStep))` is a
  compile error, because the lambda body is a direct `andThen` call enforcing
  its own overloads. `pipe` can neither strengthen nor weaken the rule.
- **Diagnostics are not worsened.** The same mistake reports the same message
  with and without `pipe`; the noise (`Argument of type 'Result<number, …>' is
  not assignable to parameter of type 'PromiseLike<Result<string, never>>'` for
  what is really `number` vs `string`) comes from `map`'s own three arms.
  A mid-chain mistake is reported **at the offending lambda**, not collapsed to
  the outer call — with one off-by-one: a step returning a *non-Result*
  type-checks on its own and is blamed one step downstream.

The tower's edge is a **cliff, not a slope**: argument 10 of a 9-arm tower
produces *two* errors — the arity error and an implicit-`any` parameter, since
past the last arm there is no contextual type. The workaround is
`pipe(pipe(…), …)` — nesting, which is the shape `pipe` existed to remove.
Effect pays for 20 arms; the depth is a pure cost dial and the mechanism does
not change with it.

## F13 — `flow` earns nothing at all

With no data-last combinators there is nothing point-free to compose: every
step after the first must be a lambda, and a step factored out for reuse must
be **fully annotated** (`const step = (r) => map(r, label)` is an implicit
`any` — there is no contextual type off-site). So `flow(f, g)` and
`(x) => pipe(f(x), g)` are the same type and the same work; `flow`'s entire
residual claim is nine characters and the ability to start from a
multi-argument function. Pinned by `expectTypeOf(viaFlow).toEqualTypeOf<typeof
viaPipe>()`. **`flow` is dead** — it cannot be justified even if `pipe` is
adopted.

## Verdict offered to the ADR (#88)

`pipe` does **not** earn its seat on ergonomics. It is longer than `/fluent`
at every call-site, adds one lambda per step, and has no name for the one
crossing that needs one. It is safe and diagnostically neutral — it just
doesn't buy anything the shipped surfaces don't already have, because the
thing that makes it pay in Effect (`dual`) is the thing this package declined
by design.

The narrow residual case, stated fairly for the grilling: a **lean-path**
caller (no `/fluent`, for bundle reasons) writing a long chain dominated by
`orElse`/`mapErr`/terminals — the one shape `safeTry` handles awkwardly, since
recovery is not a step inside a do-block but a construct wrapping one (see
`c3_safeTry`). For that caller the choice is `pipe` (flat, 8 lambdas) versus
nested (indent 12, inside-out). Whether that caller exists in enough numbers
to justify a root export, an entry in both llms briefs, and reversing a v5 cut
is the ADR's call, not the spike's.

| Learning | Action |
| --- | --- |
| F9 no `dual`, so no naked steps | The premise of Effect's ergonomics does not transfer |
| F10 longest at every call-site | Evidence against adoption |
| F11 seam has no name | Evidence against; `/fluent`'s `.toAsync()` is strictly better |
| F12 sound + diagnostically neutral | No safety objection — adoption is purely an ergonomics/scope call |
| F13 `flow` | **Decline**, unconditionally |
