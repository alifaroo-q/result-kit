---
'@zireal/result-kit': patch
---

Fix `expectOk` / `expectErr` — and every `/testing` matcher that delegates to them — throwing the wrong error when the payload resists `JSON.stringify`.

The failure message is thrown at the moment a caller is already confused about a `Result`, and three payload shapes replaced it with something worse:

- **A circular object or a `BigInt` crashed the assertion.** `JSON.stringify` throws on both — a domain model with back-references, an id from a database driver — so `expectOk(err(model))` surfaced `TypeError: Converting circular structure to JSON` instead of naming the branch. The `/testing` matchers inherited it: `expect(result).toBeOk()` reported a serializer crash rather than the `Err` it was handed.
- **A real `Error` rendered as `{}`.** `name`, `message` and `stack` are non-enumerable, so the most common `Err` payload of all — whatever a try/catch wrapper produces — reported nothing at all.
- **A symbol and a function both rendered as the literal text `undefined`**, indistinguishable from `err(undefined)`.

Payloads render through one non-throwing renderer now. A JSON-safe payload is byte-identical to before, so no message a caller could already read has changed; only the broken ones move:

```ts
expectOk(err(new Error('kaboom')));
// before: Expected Ok, got Err: {}
// after:  Expected Ok, got Err: Error: kaboom

expectOk(err(circularModel));
// before: TypeError: Converting circular structure to JSON
// after:  Expected Ok, got Err: {"type":"not_found","self":"[Circular]"}
```
