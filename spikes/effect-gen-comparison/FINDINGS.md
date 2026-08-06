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
