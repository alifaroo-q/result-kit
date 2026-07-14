# ADR 0001 — v2 core API paradigm

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: the v2 core API paradigm (keystone)](https://github.com/alifarooq-zk/result-kit/issues/10)
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifarooq-zk/result-kit/issues/8)
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md)

## Context

`@zireal/result-kit` v2 is a clean breaking major toward a **lean, zero-runtime-dependency, idiomatic** core: only the `Result` pattern plus its utilities, errors, types, and helpers. The NestJS adapter and fp-ts interop are removed; the pipeline must be re-implemented without fp-ts.

v1 ships **three** paradigms at once — a static `ResultKit.*` toolbox (~30 methods), a fluent `ResultPipeline`/`AsyncResultPipeline` built internally on fp-ts `Either`/`TaskEither`, and a bare `{ ok, value } | { ok, error }` union. v2 must commit to **one** core paradigm.

The landscape study surfaced one fork, repeated in every cluster, with one tension:

- **Free functions tree-shake to bytes; classes/namespaces ship their whole method surface** to every consumer (es-toolkit vs lodash: `pick` 132 B vs 9,520 B; Valibot vs Zod ~90% smaller; Zod conceded via `zod/mini`).
- **But fluent wins ergonomics and adoption** (neverthrow leads the genre at ~1.67M dl/wk; Zod outships Valibot ~15×).

## Decision

Adopt a **modular free-function core over a plain, method-less `Result` union, with an opt-in fluent wrapper as the documented hero.**

1. **Type.** `Result<T, E>` stays a plain, **method-less** discriminated union `{ ok: true, value } | { ok: false, error }` — the interchange format that serializes, crosses boundaries, and makes tree-shaking genuinely true (values carry no methods to drag).
2. **Core.** A modular, **data-first** free-function core (`map(r, fn)`, `andThen(r, fn)`, …) — **one signature, no currying / no data-last variants**, sidestepping the auto-curry tree-shaking trap.
3. **Façade.** An **opt-in fluent wrapper** that delegates to the same core functions (one implementation, a thin envelope — not a second codebase).
4. **Boundary — dual constructors.** Root `@zireal/result-kit` exports `ok`/`err` returning plain unions plus the tree-shakable functions. `@zireal/result-kit/fluent` exports `ok`/`err` returning the wrapper (zero-ceremony hero path `ok(v).map().andThen()`), plus `from(union)` to wrap and `.toResult()` / terminals to exit back to the plain union.
5. **Positioning.** The **fluent wrapper is the documented hero** (README default, tutorials) for adoption; the **free-function core is the first-class, supported "lean / tree-shakable" escape hatch** and the hard differentiator that class-only neverthrow structurally cannot offer (bytes for library authors and hot paths).

## Rejected alternatives

- **Fluent wrapper only (neverthrow-style).** Best DX and inference, what the market reaches for — but a class ships its whole method surface to every consumer, killing the "lean / tree-shakable" differentiator outright. Reconsidered under stress (fluent is our hero anyway, so most users won't tree-shake) and still rejected: the functional core is ~1× logic + a thin wrapper (the functions must exist for the wrapper to delegate to), so the differentiator is nearly free to keep, and it serves a real minority (library authors, hot-path apps) that fluent-only abandons.
- **Free functions only (Valibot / es-toolkit / radash).** Maximally lean, one surface — but cedes the DX the market rewards (Valibot is technically superior to Zod on every measured axis and adopted ~15× less). Rejected on adoption.
- **Pipe / data-last façade (fp-ts / remeda).** Forces data-last curried operators — either a doubled surface or a data-last core — risking the Ramda auto-curry tree-shaking trap (~15% reduction despite `sideEffects:false`). Result chains are short (2–5 ops), the regime where `pipe()`'s value is weakest. Rejected.
- **Trimmed static toolbox (`ResultKit.map(r, fn)`).** Smallest migration delta — but a static namespace object tree-shakes as badly as a class (the lodash-monolith anti-recipe). Rejected.
- **Ship both façades (fluent + pipe).** Maximum ergonomic coverage — but three surfaces to build, test, document, and keep in sync, directly against the lean destination. Over-scoped. Rejected.
- **Wrapper as the default value (true-myth-ish, methods on the value).** Best raw hero DX — but the default value carries methods, so importing `ok` drags the surface and the "lean" path becomes the ceremony-laden one. Inverts the lean claim. Rejected.

## Consequences

- The plain method-less union is the source of truth; the fluent wrapper is a transient ergonomic envelope, never the interchange or serialized type.
- Two documented surfaces exist; the cost is **documentation discipline**, not duplicated logic. Docs lead with fluent and present the functional core as the byte-conscious path.
- Downstream tickets are unblocked and now sharp: **Result type shape**, **full API surface / method inventory**, **async strategy**, **package layout & entrypoints**, and the **`?` / do-notation helper**. The **TypedError model** ([#11](https://github.com/alifarooq-zk/result-kit/issues/11)) proceeds in parallel.
- **Tree-shaking risk to guard in packaging:** the hazard is *shared internals*, not the wrapper class per se. The fluent wrapper must live in its own entrypoint and import only the core functions it delegates to, so a functional-only consumer never drags the whole surface (the ramda-vs-es-toolkit lesson).

## Retro (post-decision web triangulation)

A follow-up web retro stress-tested the decision against libraries that shipped this exact design. Three of four pillars are **actively vindicated**:

- **Plain method-less union as source of truth** — the ESM+CJS `instanceof` dual-package hazard makes any class-as-interchange-type fragile; corroborated by [`@praha/byethrow`](https://github.com/praha-inc/byethrow) (2025), a Result library that independently converged on a plain-object union + free functions as a direct reaction to neverthrow's class-extension pain.
- **Data-first, single-signature, no currying** — ramda tree-shakes only ~15% despite `sideEffects:false` because currying machinery is un-prunable ([ramda #2355](https://github.com/ramda/ramda/issues/2355)); es-toolkit's zero-shared-internals functions shake cleanly.
- **Fluent hero + functional escape hatch** — matches Zod's own positioning of `zod/mini` (["use regular Zod unless you have uncommonly strict constraints around bundle size"](https://zod.dev/packages/mini)).

The retro surfaced **one footgun outside this decision's scope**, carried into the async ticket: a custom `ResultAsync implements PromiseLike` has real sharp edges (accidental `await` collapses the chainable type; the thenable trips or silently escapes `no-floating-promises`; sync↔async inference degrades). The recommended resolution — settled in the async ticket, not here — splits along the same seam as the rest of the design: the **functional core** models async as plain `Promise<Result<T, E>>` with sync/async-unified functions (byethrow's model — no thenable, kills the doubled `xAsync`), while the **fluent path** provides an awaitable `ResultAsync` wrapper with mitigations (a must-use ESLint rule, a documented lossless `await`-collapse, never forcing users through the thenable).
