# ADR 0015 — Standard Schema issues → `TypedError` mapping

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: Standard Schema issues → TypedError mapping (the path question)](https://github.com/alifaroo-q/result-kit/issues/72)
- **Builds on:** [ADR 0002 — the `TypedError` model](./0002-v2-typederror-model.md) (which rejected a top-level `path`), [ADR 0010 — error formatter helpers](./0010-v2-error-formatter-helpers.md) (which hit the consequence of that rejection)
- **Gates:** [`fromSchema` #61](https://github.com/alifaroo-q/result-kit/issues/61)
- **Spec touchpoints:** §2.1 (JSON round-trip guarantee), §3 (`TypedError`'s four fields), §3.4 (`prettifyErrors` and the payload-in-`message` finding)

## Context

[`fromSchema` #61](https://github.com/alifaroo-q/result-kit/issues/61) adapts any [Standard Schema v1](https://standardschema.dev) validator to a `Result`. The function is small; the payload contract is a **one-way door**, and #61 was filed blocked on it for that reason.

The door is narrow because spec §3 fixes `TypedError` at exactly four fields and [ADR 0002 §3](./0002-v2-typederror-model.md) rejected a top-level `path` as validation-specific. [ADR 0010](./0010-v2-error-formatter-helpers.md) (#18) already met the consequence from the other side: Zod's `treeifyError` / `formatError` / `flattenError` are *entirely* path-derived, so none of them ports to a shape with no path. That was recorded as a finding, not a shortfall. This ADR decides where a path-bearing issue payload goes instead.

Three facts from the Standard Schema spec shape every decision below. They are quoted, not paraphrased:

```ts
export interface Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
}
export interface PathSegment { readonly key: PropertyKey }
export interface FailureResult { readonly issues: ReadonlyArray<Issue>; }
```

1. **A path segment may be a `symbol`.** `PropertyKey` is `string | number | symbol`, and `JSON.stringify` drops a symbol **silently**. This is the §2.1 collision in its sharpest form and it is in the spec's own type, not a hypothetical.
2. **`message` is the only guaranteed field.** `path` is optional. Everything a vendor actually attaches — Zod's `code`, `expected`, `input` — is off-spec: real at runtime, invisible to the types, and different per vendor.
3. **The path is heterogeneous by construction** — `PropertyKey | PathSegment` in one array. Whatever lands in `details` must resolve that or hand it to every consumer.

## Decision

### 1. One error, not an array

`fromSchema` produces a **single** `TypedError<'validation_failed', { issues }>`. Not `Result<Output, TypedError[]>`.

A `Result` has one error channel. Making `E` an array means every downstream consumer — `matchType`, `isTypedError`, a constructor's `.is()`, `unwrapOrThrow` — special-cases an array where a `TypedError` is expected, and it collides with §5.4's `combineWithAllErrors`, whose own shape is already `Result<T[], E[]>`. The accumulation pipeline story from session-1 still lands, one level up: `combineWithAllErrors` across several validated inputs, each contributing one `validation_failed`.

### 2. Issues are normalized to the spec'd fields; vendor extras are dropped

```ts
/** A Standard Schema issue, normalized to a JSON-safe shape. */
export interface ValidationIssue {
  readonly message: string;
  /** Always present; `[]` means the issue is about the root. */
  readonly path: readonly (string | number)[];
}

export type ValidationFailed = TypedError<
  'validation_failed',
  { readonly issues: readonly ValidationIssue[] }
>;
```

Pass-through was rejected. It puts unbounded, unknown-shaped, **vendor-varying** data inside `details` — the field §2.1 promises is JSON-safe. Zod attaches the failing `input` to some issues, which is a live route for PII, a `BigInt`, or a circular reference into the one contract this package sells. And a `details` shape that differs between Zod, Valibot, ArkType and Effect Schema is not an adapter; it is a leak with a function wrapped around it.

**The load-bearing trade, stated plainly: `code` is not in `details`.** Switching on *what kind* of failure occurred is not possible from the portable payload — only reading its message is. This was weighed and accepted as the price of a payload that is identical across vendors and provably JSON-safe. §5 is the escape hatch, and it is explicitly a debugging affordance, not a contract.

### 3. `path` — array only, `PathSegment` unwrapped, `symbol` coerced, root is `[]`

Normalization, in order:

1. Absent or `undefined` → `[]`.
2. A `PathSegment` (`{ key }`) is unwrapped to its `key`.
3. `string` and `number` pass through unchanged (array indices stay numbers).
4. **`symbol` → `String(key)`** — `Symbol('id')` becomes the string `"Symbol(id)"`.

**Array only, never a dotted string.** A dotted string cannot round-trip a key containing a dot, and it is derivable from the array in one line — shipping both would bake two sources of truth into a one-way door.

**The symbol coercion is lossy and total, and that combination is the point.** The alternative — keep the symbol and let `JSON.stringify` eat it — is precisely the silent-failure class this package refuses, and the same shape as the three `renderPayload` holes closed in [#67](https://github.com/alifaroo-q/result-kit/issues/67): a value that disappears without a diagnostic. Coercion is the only option that keeps §2.1 true **unconditionally**, with no fourth carve-out beside `cause`, `.toResult()`-before-serialize, and `Ok<void>`.

**Absent and `[]` collapse to `[]`.** The spec permits both and libraries disagree about which means "root". No consumer can act on the difference, and two ways to spell one thing is a bug generator.

### 4. `details` is `{ issues }` and nothing else

`vendor` (`schema['~standard'].vendor`) is a string, JSON-safe, and genuinely useful in a log line — and it is still not in `details`. **Adding an optional field to `details` later is backward-compatible; removing one is not.** On a one-way door, ship the reversible direction. It is also already reachable from `cause` and from the schema the caller is holding.

### 5. `cause` is opt-in, off by default

```ts
fromSchema(schema, { includeCause: true });
```

Off by default. When enabled, `cause` holds the vendor's **raw `readonly Issue[]`**, untouched — `code`, `expected`, `input` and all — under §2.1's existing sanitize-before-serialize carve-out. `prettifyErrors` never reads it.

Always-on was the first recommendation and was **rejected on a concrete cost**: Zod puts the failing input in its issues, so an always-on `cause` makes every validation error retain a reference to the rejected payload — PII and memory both — for as long as the error is alive, in a value people log by reflex. Opt-in keeps the debugging affordance and makes retention a decision someone made.

The raw array, not the whole `FailureResult`: the spec defines `FailureResult` as exactly `{ issues }`, so wrapping buys one level and no information.

**The flag never appears in a signature.** `cause?: unknown` is already optional on `TypedError`, so `ValidationFailed` is one type whether or not the flag is set. That is what makes opt-in cheap here and is why it does not reopen §3's four-field shape.

### 6. `message` carries a count, never issue text

- `Validation failed (3 issues)`
- `Validation failed (1 issue)` — singular at one.
- `Validation failed` — **plain, with no count clause, when `issues` is empty.**

A count is the one fact a reader would otherwise `console.log` for, and being an integer it cannot leak. Joining the issue messages, or promoting the first issue's `message` and `path`, was rejected: both interpolate vendor-authored text that may embed the received value, which is exactly the trap §3.4 recorded — a message can carry payload before any formatter runs, and no formatter can undo it. Promoting the *first* issue additionally picks an arbitrary winner.

The empty-array branch exists so the message never reads `Validation failed (0 issues)`, a sentence that reads as a bug. This mirrors [#67](https://github.com/alifaroo-q/result-kit/issues/67)'s empty-array decision in `renderDiagnostic`.

### 7. The tag is the fixed literal `'validation_failed'`

Not overridable. A stable literal keeps every consumer's error union and `matchType` (§3.5) exhaustiveness predictable; re-tagging is a one-line `mapErr`. An overridable tag would make the return type depend on an option object for a gain the caller already has — and §5's `includeCause` is deliberately the *only* member of the options bag, a behavioural flag that does not touch the type.

### 8. An empty `issues` array is still an `Err`

The spec permits a `FailureResult` with `issues: []`, and a misbehaving vendor can produce one. It stays an `Err` with `issues: []` and the count-free message from §6. **A vendor that said "failure" never becomes `Ok`.**

## Consequences

- **#61 is unblocked.** The adapter is now a small function against a settled payload contract.
- **Two new public types** — `ValidationIssue` and `ValidationFailed`. Naming a public type is itself one-way; inlining the structural shape was rejected because a shape nobody can reference gets copied, and copies drift.
- **§2.1 gains no carve-out.** The `symbol` coercion is what buys this. The guarantee's three documented exceptions stay three.
- **`code`-based branching is unavailable from `details`.** The mitigation is `includeCause` for debugging and `path` for keying. If real demand appears for a portable failure-kind discriminant, it arrives as an **additive optional field** on `ValidationIssue` (§4's reversible direction), not as a reshape.
- **Zod's tree formatters remain non-portable**, exactly as ADR 0010 §1 found — but the raw material for a tree now exists in `details.issues[].path`. A path-keyed formatter over `ValidationIssue[]` is a *possible* additive helper; nothing here commits to one, and it belongs to §3.4's family rather than to `fromSchema`.
- **Deferred to #61 as build decisions, not payload decisions:** whether this lives in the core barrel or a `/schema` subpath (and therefore CLAUDE.md's three-files rule), and the value-or-promise async convention under §10.9's `SettledOr` — Standard Schema's `validate` may return a promise.
