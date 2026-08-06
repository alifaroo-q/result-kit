# ADR 0017 — object-form `combine`, and the asymmetric error shape

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Ali Farooq
- **Ticket:** [Spec §5.4 amendment: object-form combine — signatures and naming](https://github.com/alifaroo-q/result-kit/issues/90)
- **Evidence:** [Spike: object-form combine](https://github.com/alifaroo-q/result-kit/issues/89) — `spikes/effect-gen-comparison/FINDINGS.md` Part 3 (F14–F17), experiments `10-object-combine.spike.ts`, `11-object-combine-types.spike.ts`
- **Builds on:** [ADR 0010 — error formatter helpers](./0010-v2-error-formatter-helpers.md) (`groupByType` / `prettifyErrors` and the flat `TypedError[]` they consume)
- **Spec touchpoints:** §5.4 (the combinators), §5.9 (the root export list), §10.6 (the `E | undefined` failure mode), §2.1 (the JSON round trip)

## Context

§5.4's combinators take a positional array. On success `combine` hands back a tuple, so the caller destructures by position:

```ts
const combined = combine([findUser(id), listPosts(id)]);
if (combined.ok) {
  const [user, posts] = combined.value;
}
```

Positional destructuring is fine at two elements and degrades from there — it is order-coupled, and the names exist only at the call-site. Effect's `Effect.all` accepts a record and returns one keyed by the same keys, which reads better and survives reordering. [#89](https://github.com/alifaroo-q/result-kit/issues/89) built the record form and measured it.

The spike's stated risk — that adding a record overload would degrade the tuple preservation §5.4 promises — **did not materialise, and was disproved rather than merely untriggered** (F14). An array of `Result`s is not assignable to `Record<string, Result<unknown, unknown>>`, because `length` and `push` are not `Result`s. The record overload is therefore *unreachable* for an array input regardless of declaration order. That is pinned directly as a `@ts-expect-error` on the assignability rather than inferred from overload-resolution behaviour, so it survives a compiler upgrade, and every array-side type assertion against the two-overload candidate is byte-identical to the baseline taken against the shipped `combine`.

What the spike could not settle by measurement is what `combineWithAllErrors` should do with the keys, because that is a design call. Its flat `E[]` cannot say *which* input failed. Over an array the key is the index, recoverable in principle from position; over a record it is simply gone.

## Decision

**Ship the record form as an overload pair on both combinators. Give the record form of `combineWithAllErrors` a keyed error shape, and leave the array form flat.** `partition` does not gain a record form.

### 1. Two overloads, not one unified signature

The shipped array signature stays **verbatim**, with the record overload declared beneath it. Effect puts tuple, iterable and record through *one* signature (`const Arg extends …`) dispatching in a conditional return type (`All.Return`). That spelling was rejected on one fatal cost and one minor one (F15):

- **`const T` leaks `readonly` into the success value.** `combine(roRows)` ships `Result<number[], E>` today; the unified form returns `Result<readonly number[], E>`, and an array literal yields a `readonly` tuple. That is a visible change to an already-shipped signature, at call-sites that have nothing to do with this feature. Effect can afford it because `all` was born that way; we cannot.
- The conditional needs `infer`-in-place rather than `OkTypeOf<T[K]>`, since `T` is not narrowed for a mapped type's index inside its own true branch — which is exactly why `All.Return` is written the way it is.

A third predicted cost is **withdrawn**: the deferred conditional does *not* repeat §10.9's `SettledOr` failure. Its constraint is the union of both branches, every one a `Result`, so `.ok` narrows fine inside a generic wrapper.

**Overload, not a new name.** A separate `combineRecord` / `combineAll` would push §5.4 from three exports to four or five, move the count the llms briefs state out loud, and teach two names for one operation. Since F14 makes the overloads unreachable from each other, the safety argument for a distinct name does not exist.

### 2. Key attribution — `KeyedError` entries, and the pair is knowingly asymmetric

Three shapes were implemented and typed (F17):

| | attribution | order | still an array | per-key narrowing |
| --- | --- | --- | --- | --- |
| **A** flat `E[]` (status quo) | ✗ | ✓ | ✓ | ✗ |
| **B** partial record `{ user?: NotFound }` | ✓ | ✗ | ✗ | ✓ |
| **C** entries `{ key, error }[]` | ✓ | ✓ | ✓ | ✓ (discriminated) |

**C wins, as `KeyedError<K, E>`.** It is the only candidate keeping attribution, property order, array-ness and per-key narrowing at once — `key` and `error` stay correlated per entry, so `switch (entry.key)` narrows `error` to that key's variant:

```ts
combineWithAllErrors({ user: rUser, posts: rPosts });
// Result<{ user: User; posts: Post[] },
//        (KeyedError<'user', NotFound> | KeyedError<'posts', Timeout>)[]>
```

Over an index-signature record it degenerates honestly to `KeyedError<string, E>`.

**B was rejected** on two counts: it costs §5.4's "flat array in input order" sentence outright — `.map` on the error becomes a compile error, breaking a caller migrating from the array form — and its keys are necessarily optional, so reading one gives `E | undefined`, §10.6's failure mode, unavoidable for that shape.

**A was rejected, and this is the live trade-off.** A is the only candidate keeping one error shape across both input shapes. Choosing C means the record form is *richer* than the array form it mirrors, and that asymmetry is deliberate: a record knows the name of each part, and discarding that name is the only reason not to pass a record in the first place. Under A the record form would be strictly *less* useful than the array form — an index at least survives as a position — which raises the question of why anyone would use it.

Two costs are accepted with C, and both are stated in §5.4 rather than left to be discovered:

- **It forks the accumulation story the docs teach as one thing.** CONTEXT.md calls `combineWithAllErrors` the "motivating source" for `groupByType` and `prettifyErrors`; README and both llms briefs show that pipeline. A `KeyedError[]` is not accepted by either formatter. The bridge is `errors.map((e) => e.error)` — a one-liner, but it must be documented, and CONTEXT.md's relationship line must stop claiming unconditionally that `combineWithAllErrors` produces what the formatters consume.
- **The pair is left asymmetric** until and unless the array form also grows entries, which would be a breaking change. See the reversal condition below.

A fourth option — giving the record overload to `combine` only and leaving `combineWithAllErrors` array-only — was considered and rejected. It keeps accumulation single and unambiguous, but it makes the record form usable for exactly the case where fail-fast is acceptable, and form validation over a named bag of fields is the motivating use for both halves at once.

### 3. Ordering, symbols, and the present-`undefined` hole

**"First `Err`" becomes property order for a record input** (F16). `combine({ 10: late, 2: early })` returns `early`, because `Object.keys` yields integer-like keys in ascending numeric order before insertion-ordered string keys; accumulation inherits it. Not a defect, but §5.4's sentence stopped being true as written.

**Symbol keys are invisible, and stay that way.** A symbol-keyed `Err` does not participate in the string index signature, so it type-checks and is silently dropped. Silent-drop is the wrong instinct in general; here it matches the §2.1 serialization boundary the whole package is built around and `parse.ts`'s own-enumerable rule, and closing it would cost a symbol scan on every call to defend against a shape the type system cannot express usefully. Documented, not closed.

**A present-but-`undefined` entry throws a named diagnostic.** An optional key satisfies the constraint and may carry `undefined` as a present own key; the loop read `.ok` off it and threw a bare `TypeError` — the handler-is-the-crash shape closed four times already in this codebase. It stays a hard failure, because a non-`Result` in the bag is a programming error and skipping it silently would hide a real mistake, but it reports through `render.ts`'s diagnostic family and names the offending key.

**The array path takes the same guard**, since `for...of` over a sparse array yields `undefined` identically — the hole was never record-specific, and that half is a fix to already-shipped behaviour. The two paths differ in *when* the guard fires, because the hole differs in kind:

- **Record path: validate the whole bag first.** Bags are a handful of keys, the pass is free, and the optional-key hole is a *typed* possibility. Without this, `combine({ user: err(e), posts: undefined })` returns cleanly today and crashes tomorrow from the same code the first time `user` succeeds — a programming error hiding behind a data error, on a schedule.
- **Array path: guard as visited.** A sparse array is not reachable through the signature at all, only through a cast, so the guard stays last-resort and `combine(rows)` over a large array does not pay a second pass.

### 4. `partition` does not gain a record form

Its `[T[], E[]]` tuple return has no obvious record analog — something like `[Partial<Record<K, T>>, KeyedError<K, E>[]]` is its own design, with no spike evidence behind it. Record support is a property of the *combinators*, not of §5.4 as a whole, and §5.4 says so explicitly so the omission reads as decided rather than forgotten.

## Consequences

- `KeyedError` is declared in `src/core/collections.ts` and re-exported from the root barrel — §5.4's own type, used nowhere else, the same argument `parse.ts` makes for `MalformedResult`. No default type parameters: a bare `KeyedError` would mean `{ key: string; error: unknown }` and hand back the `unknown` error §3 exists to avoid.
- **The name is `KeyedError`, not `TaggedError`.** The latter is one letter from the shipped `TypedError` and collides with Effect's `Data.TaggedError`, which this map already ruled out of scope.
- Two signature clauses are load-bearing and need a doc comment plus type-level assertions, because both read as noise and will invite a cleanup: `NonNullable<T[K]>` (without it the signature does not compile, since an optional key's `Result | undefined` fails `OkTypeOf`/`ErrTypeOf`'s constraint), and `-?` on the error mapped type but *not* on the success one (optionality must survive on the success side; on the error side it would reintroduce B's `E | undefined`).
- **One `minor` changeset** at implementation. The overloads are unreachable from array inputs (F14), so nothing existing changes type; a new type export is additive. The changeset body must name the guard change, since a caller catching a bare `TypeError` today will see a different message.
- Both llms briefs must learn `KeyedError` in the same commit, and `llms-full.txt`'s "**37 values and 13 types**" becomes **14 types** — otherwise `test/docs/agent-kit.spec.ts` goes red.
- CONTEXT.md gains a **keyed error** entry, and its `combineWithAllErrors` relationship line is repaired to name the input shape it holds for.

## Reversal condition

Revisiting the asymmetry — making the array form carry entries too — requires **a major version and evidence that callers are hand-rolling index attribution over the flat array**. Both halves, not either: absent the second, the asymmetry is a property of the record form rather than a debt against the array one, and reopening it would trade a real break for a symmetry nobody asked for.
