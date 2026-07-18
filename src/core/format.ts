import type { TypedError } from './error';

/**
 * Presentation helpers over an accumulated `TypedError[]` — spec §3.4,
 * [ADR 0010](../../docs/adr/0010-v2-error-formatter-helpers.md).
 *
 * `combineWithAllErrors` (§5.4) yields a flat `TypedError[]`: the
 * `ZodError.issues[]` analog, and the whole of the accumulation story. These two
 * functions are what you do with it.
 *
 * **Why only two, when zod ships three.** All three of zod's formatters need a
 * `path`, and this library deliberately has none —
 * [ADR 0002 §3](../../docs/adr/0002-v2-typederror-model.md) rejected a top-level
 * `path` as validation-specific and meaningless for most variants.
 *
 * They need it to differing degrees, which is worth stating precisely rather
 * than lumping together: `treeifyError` and the deprecated `formatError` are
 * **entirely** path-derived — the path *is* the tree. `flattenError` is merely
 * path-*keyed*: it buckets on `path.length === 0` and keys on `path[0]`,
 * discarding deeper segments. Either way, with no path there is no tree, and no
 * `formErrors`-vs-`fieldErrors` split either, since that split is exactly
 * `path.length === 0`.
 *
 * A second, independent reason rules out even a *positional* key:
 * `combineWithAllErrors` pushes `result.error` with no index, so which input
 * failed is **not recoverable** from the value being formatted. Any keyed shape
 * must key on something intrinsic to the error — and the one intrinsic key is
 * `type`, which is the field ADR 0002 built the model around.
 *
 * Zod's own migration is the endorsement here rather than the template: it moved
 * in 4.x from `.format()` / `.flatten()` *methods* to top-level tree-shakable
 * *functions*, which is the shape this package already had.
 */

/**
 * Groups accumulated errors by their `type` discriminant.
 *
 * ```ts
 * const groups = groupByType(errors);
 * groups.not_found?.forEach((e) => log(e.details?.id));  // NotFound[], narrowed
 * ```
 *
 * **Each group keeps its narrowed variant type**, so `groups.not_found` is
 * `NotFound[]` and its `details` is that variant's own payload — not the union's.
 * That narrowing is the reason this exists rather than a documented
 * `Object.groupBy` one-liner — but only that. `Object.groupBy` **does** keep the
 * literal keys (`Partial<Record<'not_found' | 'forbidden', AppError[]>>`); what
 * it loses is the per-group *value* type, so its `groups.not_found` is
 * `AppError[]` and `details` is the union's payload rather than the variant's.
 * An earlier draft of this note claimed the keys were lost as well, which was
 * false (ADR 0010, "Alternatives considered").
 *
 * **The keys are optional**, and that is a correctness decision. A variant in
 * the union that does not occur at runtime has no key, so a non-optional
 * `Record<E['type'], E[]>` would type `groups.forbidden` as `Forbidden[]` and
 * hand back `undefined` — the silent-wrong-value class §10.6–§10.13 exist to
 * remove. The cost is one `?.` at the call site, and it is the honest price.
 *
 * Pure: the grouped errors are the **same objects**, not copies, and the input
 * array is not mutated or reordered. Insertion order is preserved within a
 * group.
 *
 * **The returned object has a `null` prototype**, and that is a correctness
 * requirement rather than a micro-optimisation. §2 and §3 make `TypedError`
 * purely structural, so `type` is an ordinary `string` carrying domain
 * vocabulary — and `{ type: 'constructor', message }` is a perfectly valid
 * error. Accumulating into an object *literal* breaks on exactly those names:
 * `groups['toString']` finds `Object.prototype`'s member, which is neither
 * nullish nor falsy, so it is treated as an existing group and `.push` throws;
 * and `groups['__proto__'] = …` invokes the prototype **setter**, so the group
 * is written and then silently absent from `Object.keys`. A crash on one set of
 * names, silent data loss on the other.
 *
 * `Object.create(null)` has neither hazard, and it is what `Object.groupBy`
 * itself returns — the standard library reached the same conclusion for the same
 * reason. `Object.prototype` is never written to; the hazard was always reading.
 */
export function groupByType<E extends TypedError<string, unknown>>(
  errors: readonly E[],
): { [K in E['type']]?: Extract<E, { type: K }>[] } {
  const groups = Object.create(null) as Record<string, E[]>;

  for (const error of errors) {
    (groups[error.type] ??= []).push(error);
  }

  return groups as { [K in E['type']]?: Extract<E, { type: K }>[] };
}

/**
 * Renders accumulated errors as one human-readable line each.
 *
 * ```
 * ✖ not_found: No user u1
 * ✖ forbidden: Not permitted
 * ```
 *
 * The `✖` marker matches zod's `prettifyError` so the output is familiar at a
 * glance. What is deliberately *not* copied is its `→ at <path>` line: that slot
 * means **location**, and the only thing we could put there is `type`, which
 * means **classification**. Reusing a familiar visual form for a different
 * meaning would mislead exactly the reader who knows zod best, so `type` goes
 * inline instead.
 *
 * **`details` is never read.** It is arbitrary, possibly large, and possibly
 * nested — a diagnostic one-liner is the wrong place for it. Reach for
 * {@link groupByType} when you want the payload.
 *
 * **That is not a redaction guarantee, and the distinction matters.** `§3`'s
 * `defineError` accepts a *message function* computed from the payload
 * (`(d) => \`No user ${d.id}\``), so a message may already contain anything the
 * variant's author chose to interpolate. This function adds nothing to it and
 * strips nothing from it. If an error must not disclose a field, keep that field
 * out of `message` — no formatter can put it back. Pinned by test, because an
 * earlier draft of this note claimed the stronger property and was wrong.
 *
 * **An empty input returns an empty string**, not a placeholder: a formatter
 * that invents text for the no-error case cannot be composed into a larger
 * message without the caller stripping it back out again.
 */
export function prettifyErrors(
  errors: readonly TypedError<string, unknown>[],
): string {
  return errors.map((e) => `✖ ${e.type}: ${e.message}`).join('\n');
}
