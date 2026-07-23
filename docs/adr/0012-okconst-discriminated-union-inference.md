# ADR 0012 — Opt-in `okConst` for discriminated-union payloads

- **Status:** Accepted (docs-only; `okConst` not shipped)
- **Date:** 2026-07-20 (accepted 2026-07-23)
- **Deciders:** Ali Farooq
- **Ticket:** [Opt-in `okConst` (const inference) for discriminated-union payloads](https://github.com/alifaroo-q/result-kit/issues/51)
- **Builds on:** [ADR 0003 — v2 result type shape](./0003-v2-result-type-shape.md), [ADR 0007 — v2 do-notation helper](./0007-v2-do-notation-helper.md)
- **Evidence:** Empirical typecheck experiments against TypeScript 5.x / `tsgo`, run in a real Next.js adoption prototype ([#31](https://github.com/alifaroo-q/result-kit/issues/31)). Results below are observed, not predicted.

## Context

Inside a `safeTry` generator body, returning a discriminated-union literal widens its discriminant:

```ts
safeTry(function* () {
  return ok({ kind: 'noop' }); // inferred Ok<{ kind: string }> — 'noop' widened
});
```

**Mechanism (verified).** A generator's return type is inferred *bottom-up* from its `return` expressions and only then checked against the surrounding type. So the enclosing `Result<PlanChange, E>` never reaches the `ok(...)` call as a contextual type, and the bare object literal widens at that call site. Outside a generator — a function with a declared `Result<PlanChange, E>` return type — the contextual type *does* flow in, and there is no widening. This is not specific to this library; it is how object-literal widening interacts with generic calls that lack a contextual type.

## Experiment (all against `tsgo`)

| Approach | Fixes widening? | Regression |
|---|---|---|
| `safeTry<T, E>` explicit signature | **No** | Turns the targeted error into a "no overload matches" wall — the widening precedes the check, so no `safeTry` signature can reach it |
| `ok<MyUnion>({...})` — explicit type arg | Yes | None; verbose |
| `ok({...} as const)` | Yes | Deep-`readonly` — nested arrays become `readonly`, breaking `T[]` consumers |
| `ok({...} satisfies MyUnion)` | Yes | None — contextual type without `readonly` |
| `ok<const T>` — blanket const generic | Yes | **`TS4104`** — `ok(items: Item[])` becomes `Ok<readonly [...]>`, breaking every mutable-array consumer |

The `safeTry<T,E>` idea (an earlier hypothesis) is **falsified**: the compiler infers the generator body as `AsyncGenerator<…, Ok<{ kind: string }>, …>` — already widened — before the expected `Result<T,E>` is consulted. The fix can only live at the `ok(...)` call site.

## Decision

**Do not change `ok`.** A blanket `ok<const T>` trades a cosmetic papercut for hard `TS4104` errors on real array payloads (e.g. a `buildPlanSwapItems` that returns `ok(items: PlanSwapItem[])`). This is the wrong default for a general-purpose constructor.

The **primary remedy is documentation**, already shipped in [`RECIPES.md`](../../RECIPES.md#discriminated-union-returns-widen-inside-safetry): prefer `satisfies YourUnion` (no `readonly`), then `as const` (flat unions), then explicit `ok<Union>({...})`.

An **opt-in `okConst`** (a second export with `<const T>` inference, documented "for object/discriminated-union payloads, not arrays") was considered and **rejected** with the acceptance of this ADR ([#51](https://github.com/alifaroo-q/result-kit/issues/51) closed as docs-only): its only advantage over `satisfies` is skipping the type name, and it carries the identical readonly-array trap. Docs-only keeps net-new symbols off the just-frozen root surface.

## Consequences

- `ok`'s inference is unchanged; array and value payloads keep their mutable types.
- The gotcha is a documented caller-side pattern, not an API change — the cheapest resolution that does not regress the common path.
- If `okConst` is later shipped, it is additive and opt-in; nothing here reverses.
