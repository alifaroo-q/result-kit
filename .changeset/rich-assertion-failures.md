---
'@zireal/result-kit': patch
---

`expectOk` / `expectErr` now render a `TypedError` as prose instead of JSON

A wrong-branch assertion failure whose payload is a `TypedError` — or an array
of them, as `combineWithAllErrors` produces — now reads as its §3.4
`✖ type: message` line with `details` and `cause` beneath it:

```
Expected Ok, got Err:
  ✖ not_found: No user u1
    details: {"id":"u1"}
```

Previously that was one line of `JSON.stringify` output. Every other payload
renders exactly as before, byte for byte. The `/testing` matchers delegate
their wrong-branch messages to these two functions, so `toBeOk` / `toBeOkWith`
/ `toBeErr` / `toBeErrWith` inherit the richer output with no change to how
they are used.

Also fixes a latent crash in the shared diagnostic renderer: a value whose
property reads throw — a `Proxy` with a hostile `get` trap — could escape the
renderer's own `catch` via `Object.prototype.toString`, replacing the
diagnostic with an unrelated `Error`. Such a value now renders as
`[unrenderable object]`.
