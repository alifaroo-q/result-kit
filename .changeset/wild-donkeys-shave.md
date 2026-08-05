---
'@zireal/result-kit': minor
---

Add `fromSchema` / `fromSchemaAsync` — Standard Schema interop.

Any [Standard Schema v1](https://standardschema.dev) validator (Zod 4, Valibot, ArkType, Effect Schema) becomes a `Result`-returning function:

```ts
import { fromSchema, isErr } from '@zireal/result-kit';

const parseUser = fromSchema(UserSchema);

const result = parseUser(await req.json()); // Result<User, ValidationFailed>
if (isErr(result)) {
  for (const { path, message } of result.error.details.issues) {
    console.log(path.join('.'), message);
  }
}
```

Standard Schema is a **types-only** spec and its interface is vendored, so this adds no dependency and no peer dependency — the zero-dependency stance is unchanged.

The failure is a **single** `TypedError<'validation_failed', { issues }>`, so it composes with `matchType`, `groupByType` and `combineWithAllErrors` like any other typed error. Each issue is normalized to the two fields Standard Schema guarantees — `message`, and `path` as an array (`[]` is the root, a `symbol` segment is coerced with `String`) — which keeps `details` identical across vendors and provably JSON-safe, so a validation error crosses the wire under the existing round-trip guarantee.

The deliberate trade: vendor extras (Zod's `code`, `expected`, `input`) are dropped, so you cannot branch on the failure *kind* from `details`. Pass `{ includeCause: true }` to keep the raw issues on `cause` for debugging; it is off by default because Zod attaches the rejected input, and an always-on `cause` would retain that payload inside a value people log by reflex.

`fromSchema` is synchronous and throws if handed an async schema — Standard Schema's own type says any schema *may* be async, so it cannot be rejected at compile time. `fromSchemaAsync` accepts both and is the one to reach for when that is not statically known.

New exports: `fromSchema`, `fromSchemaAsync`, and the types `ValidationIssue`, `ValidationFailed`, `FromSchemaOptions`. See [ADR 0015](https://github.com/alifaroo-q/result-kit/blob/main/docs/adr/0015-standard-schema-issue-mapping.md) for the full rationale.
