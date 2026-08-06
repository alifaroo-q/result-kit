---
'@zireal/result-kit': minor
---

`combine` and `combineWithAllErrors` accept a **record**, and the not-a-`Result` diagnostic now names where it failed — on the array path too.

**Record ("object form") overloads.** Both combinators take a record of `Result`s and return one keyed identically, so the success side is destructured by name instead of by position:

```ts
const combined = combine({ user: findUser(id), posts: listPosts(id) });
if (combined.ok) {
  const { user, posts } = combined.value;
}
```

The array signatures are unchanged and still declared first. An array of `Result`s is not assignable to `Record<string, Result<unknown, unknown>>`, so the record overload is unreachable for an array input and tuple preservation cannot degrade.

The record form of `combineWithAllErrors` accumulates `KeyedError<K, E>` entries — `{ readonly key: K; readonly error: E }`, a new root type export — rather than a flat array, so a failure says which key produced it and `switch (entry.key)` narrows `error` to that key's variant. **The array form stays flat.** Because of that split, a `KeyedError[]` is not accepted by `groupByType` or `prettifyErrors`; bridge with `errors.map((e) => e.error)`.

Over a record, "first `Err`" means **property order** (`Object.keys`: integer-like keys ascending, then insertion order), own enumerable keys only. Symbol keys are silently invisible. `combine({})` is `ok({})`. `partition` does not gain a record form.

**The not-a-`Result` diagnostic, and the array path changes with it.** A value in the bag that is not a `Result` still throws — a non-`Result` there is a programming error, and skipping it silently would hide a real mistake — but the message now names the combinator and the offending key or index:

```
combine: value at key "posts" is not a Result (received: undefined)
```

This reaches **already-shipped array behaviour**: a hole in a sparse array yields `undefined` under `for...of` identically, so `combine(sparse)` previously threw a bare `TypeError: Cannot read properties of undefined (reading 'ok')` and now throws the named form. If you are grepping for why a `TypeError` message changed, this is why. It is not a breaking change — both the old and the new failures are throws, and neither message was documented — but the text is different.

The guard is **element-wise, not hole-specific**: any array element that is not readable as a `Result` gets the same named diagnostic, where before a non-object element was read as a falsy `.ok` and returned *as if it were an `Err`*. Both are reachable only by casting past the signature. Relatedly, an input that is neither an array nor a record — a non-array **iterable** such as a `Set<Result>`, a primitive, or `null`, all cast-only — is now rejected with `expected an array or a record of Results, but received …` rather than answering `ok({})`. §5.4 ships no iterable overload, and declining one silently was the worse of the two.

The record path validates the whole bag before reading any of it, so the diagnostic is deterministic rather than hiding behind whichever `Err` came first; the array path guards as visited, so the hot path pays no second pass.
