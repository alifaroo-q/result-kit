---
'@zireal/result-kit': minor
---

Add `isResult` / `parseResult` — validating re-entry from `unknown`.

A `Result` crosses the wire by spec, but `JSON.parse` hands it back as `unknown`, and until now the only way to close that gap was `as Result<T, E>` — an assertion nothing verifies, on data you did not author. These are the checked form of that cast:

```ts
import { isErr, isOk, parseResult } from '@zireal/result-kit';

const parsed = parseResult(await response.json());
if (isErr(parsed)) {
  console.error(parsed.error.details.reason); // 'not_an_object' | 'error_dropped' | …
  return;
}

const result = parsed.value; // Result<unknown, unknown>
if (isOk(result)) result.value;
```

`isResult` is the same check as a type predicate for when you just want an `if`; both run one implementation, so they cannot disagree. The failure is a single `TypedError<'malformed_result', { reason }>` whose `reason` is a **closed union**, so you can branch on the failure kind.

**Both payload halves stay `unknown`, and there is no generic parameter** — `parseResult<User, E>(json)` would be the same unchecked assertion behind a friendlier face. This proves the envelope; narrow the payload with `fromSchema` or your own guard.

It validates and never rewrites: on success you get back the same object, so extra properties — a `traceId` a gateway stamped on the envelope — ride through untouched. §2's two-field rule governs what this package builds, not what it will look at.

The two decisions worth knowing, both about properties `JSON.stringify` drops:

- A round-tripped `ok()` arrives as `{ ok: true }` with no `value` key and is **accepted** — spec §10.9 carves it out because it is the output of the form §5.1 recommends for a void success.
- A bare `{ ok: false }` is **rejected** as `'error_dropped'`. `err` has no no-arg form, so that shape only means a non-JSON-serializable payload was dropped in transit; send `"error": null` for a detail-free failure. Accepting it would hand back an `Err` whose `.error` is `undefined`, which crashes `matchType`, `groupByType` and `prettifyErrors` a hop later.

New exports: `isResult`, `parseResult`, and the types `MalformedResult`, `MalformedResultReason`.
