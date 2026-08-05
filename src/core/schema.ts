import { err, ok } from './result';
import type { Result } from './result';
import { isThenable } from './thenable';
import type { TypedError } from './error';

/**
 * Standard Schema interop (spec §5.5's family, [ADR 0015]) — the sixth way
 * **into** the `Result` world, and the only one whose `E` channel this package
 * chooses on the caller's behalf.
 *
 * [Standard Schema v1](https://standardschema.dev) is a **types-only** spec: a
 * validator opts in by exposing a `~standard` property, and nothing is imported
 * at runtime. That is what lets this live in the core barrel without moving the
 * zero-dependency stance — there is no dependency to add.
 *
 * The payload contract is settled by [ADR 0015] and is a **one-way door**; the
 * decisions it fixes are cited section-by-section below rather than restated.
 * Two decisions belong to *this* module instead:
 *
 * 1. **Home** — `src/core/schema.ts`, exported from the root barrel, not a
 *    `/schema` subpath. Both existing subpaths had a forcing function that this
 *    lacks: `/fluent` is required by §7.3's bundle boundary, `/testing` by an
 *    optional `vitest` peer. A fourth entrypoint for one types-only function
 *    would buy a chunk, three files to keep in sync, and a boundary spec, and
 *    the §7.1 barrel is self-tree-shakable, so nobody who does not import
 *    `fromSchema` pays for it. Its own module rather than a sixth entry in
 *    `interop.ts` because it brings two public types and the vendored spec
 *    types with it — the same argument §3.4's `format.ts` makes.
 *
 * 2. **Sync and async are two functions, not one union** — see
 *    {@link fromSchema} and {@link fromSchemaAsync}.
 *
 * [ADR 0015]: ../../docs/adr/0015-standard-schema-issue-mapping.md
 */

/* -------------------------------------------------------------------------- *
 * The vendored spec types
 * -------------------------------------------------------------------------- */

/**
 * Standard Schema v1's public interface, **vendored** rather than taken from
 * `@standard-schema/spec`.
 *
 * The spec ships types and nothing else, so a dependency here would exist only
 * to be erased — and it would not reliably erase. A `.d.ts` rollup is free to
 * re-emit a type-only import of the spec package into `dist/index.d.ts`, which
 * puts a bare specifier in a shipped artifact: exactly the failure class
 * [test/testing/boundary.spec.ts] was built to catch, and one that breaks
 * resolution for anyone who did not install that package. Copying twenty lines
 * of interface keeps the zero-dependency claim literal rather than conditional
 * on a bundler's behaviour.
 *
 * *(That sentence deliberately describes the import rather than spelling one
 * out. §7.3's scanner strips comments before looking for imports precisely
 * because `src/testing/`'s doc comment did spell one out, and the un-stripped
 * scanner then reported the shipped bundle importing `vitest` — the opposite of
 * the truth. No reason to re-arm that trap in a second module.)*
 *
 * **Nothing nominal is lost by copying it.** TypeScript is structural, so a
 * Zod, Valibot, ArkType or Effect Schema value satisfies this declaration
 * because of its shape, not because of where the declaration came from.
 *
 * Not re-exported from the barrel. [ADR 0015] names exactly two new public
 * types ({@link ValidationIssue}, {@link ValidationFailed}); this one appears in
 * the emitted `.d.ts` as an inlined internal declaration, the way `SettledOr`
 * already does for §5.2's transforms.
 *
 * [ADR 0015]: ../../docs/adr/0015-standard-schema-issue-mapping.md
 * [test/testing/boundary.spec.ts]: ../../test/testing/boundary.spec.ts
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

/** A validator's outcome: the parsed value, or the issues that rejected it. */
type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[] };

/**
 * A raw, vendor-authored issue.
 *
 * `message` is the only guaranteed field, and `path` is **heterogeneous by
 * construction** — `PropertyKey | PathSegment` in one array, where `PropertyKey`
 * admits `symbol`. Both facts drive the normalization in {@link ValidationIssue}.
 */
interface StandardIssue {
  readonly message: string;
  readonly path?:
    | readonly (PropertyKey | { readonly key: PropertyKey })[]
    | undefined;
}

/**
 * The output type a schema parses to.
 *
 * Read through `types` rather than off `validate`'s return: `types` is the
 * property vendors populate for exactly this purpose, and inferring from a
 * union-returning method is the fragile direction.
 */
type InferOutput<S extends StandardSchemaV1> = NonNullable<
  S['~standard']['types']
>['output'];

/* -------------------------------------------------------------------------- *
 * The public payload — ADR 0015 §2, §3
 * -------------------------------------------------------------------------- */

/**
 * A Standard Schema issue normalized to a JSON-safe shape ([ADR 0015] §2).
 *
 * Exactly the two fields the spec *guarantees*. Vendor extras — Zod's `code`,
 * `expected`, `input` — are **dropped**, and that is the load-bearing trade:
 * branching on *what kind* of failure occurred is not possible from the
 * portable payload. A `details` that varies between Zod, Valibot and ArkType is
 * not an adapter, and Zod's `input` is a live route for PII, a `BigInt` or a
 * cycle into the one field §2.1 promises is JSON-safe. The raw issues stay
 * reachable behind {@link FromSchemaOptions.includeCause}.
 *
 * [ADR 0015]: ../../docs/adr/0015-standard-schema-issue-mapping.md
 */
export interface ValidationIssue {
  /** The vendor's own message, passed through untouched. */
  readonly message: string;

  /**
   * Where the issue is, as an array. **Always present**; `[]` means the root.
   *
   * An array and never a dotted string: a dotted string cannot round-trip a key
   * that contains a dot, and it is one `join` away from this — shipping both
   * would bake two sources of truth into a one-way door.
   *
   * A `symbol` segment is coerced with `String(key)`, so `Symbol('id')` reads as
   * `"Symbol(id)"`. **The coercion is lossy and total, and that combination is
   * the point:** the alternative is letting `JSON.stringify` drop the segment
   * silently, which is the same disappearing-value class as the three
   * `renderPayload` holes closed in #67. Coercion is the only option that keeps
   * §2.1 true unconditionally, with no fourth carve-out.
   */
  readonly path: readonly (string | number)[];
}

/**
 * The error `fromSchema` produces — **one** `TypedError`, never an array
 * ([ADR 0015] §1).
 *
 * A `Result` has one error channel. Making `E` an array would force `matchType`,
 * `isTypedError`, a constructor's `.is()` and `unwrapOrThrow` to each
 * special-case an array where a `TypedError` is expected, and it collides with
 * §5.4's `combineWithAllErrors`, whose own shape is already `Result<T[], E[]>`.
 * The accumulation story still lands, one level up: `combineWithAllErrors`
 * across several validated inputs, each contributing one `validation_failed`.
 *
 * The tag is a fixed literal and is not overridable — a stable tag keeps every
 * consumer's error union and §3.5 `matchType` exhaustiveness predictable, and
 * re-tagging is a one-line `mapErr`.
 *
 * [ADR 0015]: ../../docs/adr/0015-standard-schema-issue-mapping.md
 */
export type ValidationFailed = TypedError<
  'validation_failed',
  { readonly issues: readonly ValidationIssue[] }
>;

/** Options shared by {@link fromSchema} and {@link fromSchemaAsync}. */
export interface FromSchemaOptions {
  /**
   * Attach the vendor's **raw** `issues` array to `cause`, untouched — `code`,
   * `expected`, `input` and all — under §2.1's existing sanitize-before-
   * serialize carve-out. `prettifyErrors` never reads it.
   *
   * **Off by default, and that default was the decision** ([ADR 0015] §5).
   * Always-on was the first recommendation and was rejected on a concrete cost:
   * Zod puts the failing input in its issues, so an always-on `cause` makes
   * every validation error retain a reference to the rejected payload — PII and
   * memory both — for as long as the error is alive, inside a value people log
   * by reflex. Opt-in keeps the debugging affordance and makes retention a
   * decision somebody made.
   *
   * Setting this does not change the return type: `cause?: unknown` is already
   * optional on `TypedError`, so {@link ValidationFailed} is one type either
   * way.
   *
   * [ADR 0015]: ../../docs/adr/0015-standard-schema-issue-mapping.md
   *
   * @defaultValue `false`
   */
  readonly includeCause?: boolean;
}

/* -------------------------------------------------------------------------- *
 * Normalization
 * -------------------------------------------------------------------------- */

/**
 * Coerces one path key to something `JSON.stringify` cannot lose ([ADR 0015]
 * §3).
 *
 * **The coercion is total, and it has to be.** §3 argues the `symbol` case and
 * concludes that coercion "is the only option that keeps §2.1 true
 * unconditionally, with no fourth carve-out" — but `symbol` is not the only key
 * that breaks it, and the others are reachable from a *real* vendor:
 * Valibot's path items include a Map key (`{ key: unknown }` — any value at
 * all) and a Set key (`{ key: null }`). A `v.map(v.bigint(), …)` failure put a
 * `BigInt` in `details` and made `JSON.stringify` on the whole `Result` throw;
 * an object key was retained **by identity**, carrying the caller's own graph —
 * cycles, PII and all — into the one field §2.1 promises is safe, and doing it
 * with `includeCause` *off*, which is the retention cost §5 rejected always-on
 * `cause` to avoid. Handling only `symbol` was the spec's example mistaken for
 * the spec's rule.
 *
 * So: `string` passes through; a **finite** `number` passes through (array
 * indices stay numbers); everything else becomes `String(key)`. Lossy and
 * total, exactly as §3 intends.
 *
 * Three narrower cases fold in here rather than being special-cased, because
 * each one is a value that `JSON.stringify` quietly rewrites: `NaN` and
 * `±Infinity` serialize to `null`, and `-0` serializes to `0`. Each would make
 * `JSON.parse(JSON.stringify(err))` differ from `err` — the round trip §2.1
 * sells — so a non-finite number is stringified and `-0` is normalized to `0`.
 *
 * [ADR 0015]: ../../docs/adr/0015-standard-schema-issue-mapping.md
 */
function normalizeKey(key: unknown): string | number {
  if (typeof key === 'string') return key;
  if (typeof key === 'number') {
    if (!Number.isFinite(key)) return String(key);
    // `-0 === 0`, so this normalizes the negative zero without touching others.
    return key === 0 ? 0 : key;
  }
  try {
    return String(key);
  } catch {
    // A `toString` / `Symbol.toPrimitive` that throws, or a revoked `Proxy`.
    // `render.ts`'s vocabulary, for the reason it exists: the diagnostic must
    // not become the crash.
    return '[unrenderable key]';
  }
}

/**
 * Reads a path segment's key, tolerating a hostile segment.
 *
 * A `PropertyKey` is `string | number | symbol` and never an object, so an
 * object here is a `PathSegment` and nothing else. The `try` is for a segment
 * whose `key` is a throwing getter or a revoked `Proxy` — the property read
 * itself is the risk, before any coercion happens.
 */
function readSegmentKey(segment: unknown): unknown {
  if (typeof segment !== 'object' || segment === null) return segment;
  try {
    return (segment as { readonly key?: unknown }).key;
  } catch {
    return undefined;
  }
}

/**
 * Normalizes a raw `path` to `readonly (string | number)[]` ([ADR 0015] §3).
 *
 * Absent and `[]` **collapse to `[]`**. The spec permits both and vendors
 * disagree about which means "root"; no consumer can act on the difference, and
 * two ways to spell one thing is a bug generator.
 *
 * **Anything that is not an array collapses to `[]` too**, and that guard is
 * load-bearing rather than defensive. `path` is optional in the spec, so a
 * vendor spelling it as the dotted string `'user.email'` is the single most
 * plausible non-conformance — §3 spends a paragraph rejecting that spelling as
 * an *output*, which is exactly why it turns up as an *input*. Iterating it
 * yields one segment per character (`['u','s','e','r',…]`), a confidently wrong
 * path rather than a missing one; a non-iterable `path` threw a raw
 * `TypeError: path is not iterable` instead of this module's diagnostic.
 *
 * [ADR 0015]: ../../docs/adr/0015-standard-schema-issue-mapping.md
 */
function normalizePath(path: unknown): readonly (string | number)[] {
  if (!Array.isArray(path)) return [];

  const segments: (string | number)[] = [];
  for (const segment of path) {
    segments.push(normalizeKey(readSegmentKey(segment)));
  }
  return segments;
}

/**
 * Normalizes one raw issue, tolerating a malformed one.
 *
 * A malformed issue is **coerced, not thrown on**, and the asymmetry with
 * `toResult`'s malformed-*outcome* throw is deliberate. A vendor that returned
 * neither a value nor an issue list said nothing this adapter can interpret. A
 * vendor that returned a genuine failure containing one junk entry *did* say
 * something — it said the input is invalid — and throwing there would convert a
 * validation failure into a crash, losing the very answer the caller asked for.
 * §8's rule generalizes: a vendor that said "failure" never stops being one.
 */
function normalizeIssue(issue: unknown): ValidationIssue {
  let rawMessage: unknown;
  let rawPath: unknown;

  if (typeof issue === 'object' && issue !== null) {
    try {
      rawMessage = (issue as { readonly message?: unknown }).message;
      rawPath = (issue as { readonly path?: unknown }).path;
    } catch {
      // A throwing getter, or a revoked `Proxy` in the issues array.
      rawMessage = undefined;
    }
  } else {
    // A primitive where an issue was promised. Keeping its text beats
    // `message: undefined`, which is not even JSON round-trippable — the key
    // vanishes on `stringify`.
    rawMessage = issue;
  }

  return {
    message: typeof rawMessage === 'string' ? rawMessage : normalizeMessage(rawMessage),
    path: normalizePath(rawPath),
  };
}

/** Coerces a non-string `message` to one, so `details` stays serializable. */
function normalizeMessage(message: unknown): string {
  try {
    return String(message);
  } catch {
    return '[unrenderable message]';
  }
}

/**
 * The `message` ([ADR 0015] §6) — a **count**, never issue text.
 *
 * A count is the one fact a reader would otherwise `console.log` for, and being
 * an integer it cannot leak. Joining the issue messages, or promoting the
 * first, was rejected: both interpolate vendor-authored text that may embed the
 * received value, which is §3.4's recorded trap — a message can carry payload
 * before any formatter runs, and no formatter can undo it.
 *
 * The empty branch drops the clause entirely rather than reading
 * `Validation failed (0 issues)`, a sentence that reads as a bug. This mirrors
 * #67's empty-array decision in `renderDiagnostic`.
 *
 * [ADR 0015]: ../../docs/adr/0015-standard-schema-issue-mapping.md
 */
function messageFor(count: number): string {
  if (count === 0) return 'Validation failed';
  return `Validation failed (${count} ${count === 1 ? 'issue' : 'issues'})`;
}

/** Builds the `ValidationFailed` for a vendor's issue list. */
function toValidationFailed(
  issues: readonly StandardIssue[],
  includeCause: boolean,
): ValidationFailed {
  // `Array.from` rather than `issues.map`: `map` preserves holes, so a sparse
  // `issues` array produced `[ <hole>, … ]`, which `JSON.stringify` writes as
  // `null` — another way for the round trip to come back different.
  const normalized = Array.from(issues, normalizeIssue);

  const error: ValidationFailed = {
    type: 'validation_failed',
    message: messageFor(normalized.length),
    // `{ issues }` alone ([ADR 0015] §4). `vendor` is a string, JSON-safe and
    // useful in a log line, and it is still not here: adding an optional field
    // to `details` later is backward-compatible, removing one is not, so on a
    // one-way door only the reversible direction ships.
    details: { issues: normalized },
  };

  // Spread conditionally rather than writing `cause: undefined`. An always-
  // present key is structurally present even when it holds `undefined`, and §2
  // fixes the shape of what this package emits.
  return includeCause ? { ...error, cause: issues } : error;
}

/**
 * Converts a settled validator outcome into a `Result`.
 *
 * **Both constructors funnel through here**, which is the point: the sync half
 * additionally has to tell a settled outcome from a promise, and if that check
 * also decided the success/failure/malformed split, the pair could disagree
 * about the same malformed input — `fromSchema` throwing where `fromSchemaAsync`
 * silently manufactured an empty failure. Caught by a test, which is why the
 * split lives here and only here.
 */
function toResult<Output>(
  outcome: StandardResult<Output>,
  includeCause: boolean,
): Result<Output, ValidationFailed> {
  // The object check comes first, and it is not defensive padding: `'value' in
  // outcome` below throws its own `TypeError` on a primitive, so a vendor
  // returning a bare string would have escaped with "Cannot use 'in' operator"
  // instead of the diagnostic — the same shape as the three holes #67 closed in
  // `renderPayload`, a handler crashing where it exists to report. Found by a
  // test, not by review.
  if (typeof outcome !== 'object' || outcome === null) {
    throw new TypeError(
      'fromSchema: schema returned neither a value nor an issue list.',
    );
  }

  // Probe the shape once, behind a `try`. Reading `.issues` or asking `'value'
  // in outcome` can itself throw — a `get`/`has` trap, or a revoked `Proxy` —
  // and the handler that exists to report a malformed outcome must not become
  // the crash. Third time this module has hit that shape; see #67's three.
  let issues: unknown;
  let hasValue: boolean;
  try {
    issues = (outcome as { readonly issues?: unknown }).issues;
    hasValue = 'value' in outcome;
  } catch {
    throw new TypeError(
      'fromSchema: schema returned neither a value nor an issue list.',
    );
  }

  // The spec's own discriminant: `FailureResult` declares `issues` required,
  // `SuccessResult` declares it `?: undefined`. The permitted `issues: []` lands
  // here and stays an `Err` with the count-free message — a vendor that said
  // "failure" never becomes `Ok` ([ADR 0015] §8).
  //
  // `Array.isArray` is asked BEFORE `'value' in outcome`, and that order is not
  // stylistic: Valibot's *failure* result is `{ value, typed, issues }`, so the
  // other order returns `Ok` holding the invalid input for every Valibot user.
  if (Array.isArray(issues)) {
    return err(toValidationFailed(issues, includeCause));
  }

  // `issues === undefined` is required as well as `hasValue`. A malformed
  // `{ issues: null, value: 1 }` satisfies `hasValue` alone, and dropping the
  // first clause would report `Ok(1)` for an outcome that named neither shape.
  if (issues === undefined && hasValue) {
    return ok((outcome as { readonly value: Output }).value);
  }

  // Neither spec'd shape — `{}`, `{ issues: null }`, a bare string. Throwing
  // beats inventing an answer: `ok(undefined)` would report a success the vendor
  // never claimed, and an empty `validation_failed` would claim an issue list
  // that does not exist. Both are silent; this is not.
  throw new TypeError(
    'fromSchema: schema returned neither a value nor an issue list.',
  );
}

/**
 * Whether a validator's return value is **settled** rather than a promise of
 * one — asked in that order, and the order is the point.
 *
 * §10.11's lesson applied to a second surface: ask "is this thenable?" first and
 * a settled outcome that happens to carry a `then` is assimilated. Here the two
 * shapes are distinguishable in the direction that matters — a settled outcome
 * has an own `value` key or an `issues` array, and a promise of one has
 * neither — so the specific question is asked before the general one. A foreign
 * `Promise` still fails this and still awaits, so §10.6's cross-realm fix is
 * untouched.
 */
function isSettledValidation<Output>(
  outcome: StandardResult<Output> | Promise<StandardResult<Output>>,
): outcome is StandardResult<Output> {
  if (typeof outcome !== 'object' || outcome === null) return false;
  return Array.isArray((outcome as { issues?: unknown }).issues) || 'value' in outcome;
}

/**
 * Whether the outcome is a promise this module must await — the **one**
 * classification both constructors use, answered without ever throwing.
 *
 * Two reasons it is a shared helper rather than an expression at each call
 * site. First, the halves must classify identically or the pair disagrees, and
 * they already did once. Second, both probes it runs can *themselves* throw on
 * a hostile outcome — `isSettledValidation` reads `.issues` and asks `'value'
 * in outcome`, `isThenable` reads `.then`, and a revoked `Proxy` or a throwing
 * getter turns either into the crash. That put the classifier **before**
 * `toResult`'s guarded probe, so the diagnostic could never be reached: the
 * fourth appearance in this codebase of a handler positioned after the failure
 * it exists to report, and the second in this module.
 *
 * An outcome that cannot be classified is reported as **not pending**, which
 * hands it to `toResult` — the one place that owns the malformed-outcome
 * diagnostic. `isThenable` itself is untouched: §10.6 gives that check exactly
 * one definition, and this is a guard at a call site, not a second copy.
 */
function isPendingValidation(outcome: unknown): boolean {
  try {
    return (
      !isSettledValidation(outcome as StandardResult<unknown>) &&
      isThenable(outcome)
    );
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- *
 * The constructors
 * -------------------------------------------------------------------------- */

/**
 * Adapts any [Standard Schema v1](https://standardschema.dev) validator — Zod 4,
 * Valibot, ArkType, Effect Schema — into a reusable function returning a
 * {@link Result}.
 *
 * ```ts
 * const parseUser = fromSchema(UserSchema);
 *
 * const result = parseUser(req.body); // Result<User, ValidationFailed>
 * if (isErr(result)) {
 *   for (const issue of result.error.details.issues) {
 *     console.log(issue.path.join('.'), issue.message);
 *   }
 * }
 * ```
 *
 * **Lazy and reusable**, matching `fromThrowable`: one wrap serves every call
 * site.
 *
 * **Synchronous, with {@link fromSchemaAsync} as its pair.** The async-ness here
 * comes from the *schema*, which is the same place `fromThrowable` /
 * `fromThrowableAsync` take theirs from, and that pair is the precedent this
 * follows. §10.9's `SettledOr` was the other candidate and does not fit: it
 * reduces to a plain `Result` only when the callback's return type holds no
 * thenable, and Standard Schema types `validate` as
 * `Result<Output> | Promise<Result<Output>>` **unconditionally** — so it would
 * never reduce, and every caller would pay a union and an `await` even when
 * validating synchronously, which is the majority case and often inside a
 * function that cannot be made async at all.
 *
 * @throws {TypeError} if `schema` validates **asynchronously**. The information
 * needed to reject that statically does not exist — the spec's own type says
 * every schema *may* be async — so it is caught at runtime and thrown loudly,
 * the call #64's `matchType` made rather than returning `undefined` under a type
 * promising a value. Reach for {@link fromSchemaAsync}, which accepts sync and
 * async schemas alike and is therefore the safe default when the schema is not
 * known statically.
 *
 * @remarks
 * A schema that *throws* — as opposed to reporting issues — propagates. A crash
 * is not a validation failure, and laundering it into `validation_failed` would
 * claim an issue list that does not exist; wrap the call in `fromThrowable` if
 * an untrusted schema needs containing.
 */
export function fromSchema<S extends StandardSchemaV1>(
  schema: S,
  options?: FromSchemaOptions,
): (input: unknown) => Result<InferOutput<S>, ValidationFailed> {
  const includeCause = options?.includeCause === true;
  const standard = schema['~standard'];

  return (input: unknown): Result<InferOutput<S>, ValidationFailed> => {
    const outcome = standard.validate(input) as
      | StandardResult<InferOutput<S>>
      | Promise<StandardResult<InferOutput<S>>>;

    // Settled-first, then thenable — §10.11's ordering, via the classifier both
    // halves share. Everything that is not a promise goes to `toResult`, which
    // owns the success/failure/malformed verdict for the pair.
    if (isPendingValidation(outcome)) {
      // Defuse the promise this call is about to abandon. An async schema that
      // *rejects* — `z.string().refine(async () => { throw … })` — otherwise
      // raises an unhandled rejection a tick after the `throw` below, which
      // under Node's default `--unhandled-rejections=throw` kills the process
      // even though the caller already caught this `TypeError`. That turns the
      // diagnostic into a fatal error, which is the opposite of its job.
      try {
        void Promise.resolve(outcome).catch(() => {});
      } catch {
        // A hostile `then` that throws synchronously. Nothing to defuse, and
        // the diagnostic below is still the right answer.
      }

      throw new TypeError(
        `fromSchema: schema (vendor "${standard.vendor}") validated asynchronously. Use fromSchemaAsync instead.`,
      );
    }

    return toResult(outcome as StandardResult<InferOutput<S>>, includeCause);
  };
}

/**
 * The async pair of {@link fromSchema} — the same adapter over a schema that
 * validates asynchronously.
 *
 * ```ts
 * const parseUser = fromSchemaAsync(UserSchema);
 *
 * const result = await parseUser(req.body); // Result<User, ValidationFailed>
 * ```
 *
 * Returns a plain `Promise<Result<T, E>>`: `await` it and you hold ordinary
 * data. No wrapper, no new async type — spec §4's self-sufficiency invariant,
 * the same shape `fromPromise` and `fromThrowableAsync` hold to.
 *
 * **Accepts synchronous schemas too**, because `await` on a non-promise is
 * well-defined. That asymmetry is deliberate: this direction costs a microtask,
 * while the other — an async schema handed to {@link fromSchema} — cannot be
 * served at all and throws. When it is not statically known which kind of schema
 * a caller will pass, this is the one to reach for.
 *
 * @remarks
 * A schema that **rejects** — as opposed to resolving with issues — propagates,
 * for {@link fromSchema}'s reason: a crash is not a validation failure. This is
 * the one place the family's usual rejection-catching does not apply, and it is
 * why `onReject` has no counterpart in the options bag.
 */
export function fromSchemaAsync<S extends StandardSchemaV1>(
  schema: S,
  options?: FromSchemaOptions,
): (input: unknown) => Promise<Result<InferOutput<S>, ValidationFailed>> {
  const includeCause = options?.includeCause === true;
  const standard = schema['~standard'];

  return async (
    input: unknown,
  ): Promise<Result<InferOutput<S>, ValidationFailed>> => {
    const outcome = standard.validate(input) as
      | StandardResult<InferOutput<S>>
      | Promise<StandardResult<InferOutput<S>>>;

    // **Settled-first here too**, and this half needs it as much as the sync
    // one. A bare `await` looks like it makes the question moot; it does the
    // opposite. §2's union is brandless, so a settled outcome may also carry a
    // `then`, and `await` hands the value to it — a `FailureResult` whose
    // `then` resolves with `{ value }` came back as `Ok`, which is §8's rule
    // broken by the very construct meant to be safe, and a `then` that never
    // calls back hung forever. The sync half rejected that input correctly
    // while this one accepted it: the pair disagreed.
    const settled = isPendingValidation(outcome) ? await outcome : outcome;

    return toResult(settled as StandardResult<InferOutput<S>>, includeCause);
  };
}
