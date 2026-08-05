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

Also fixes three latent defects in the shared diagnostic renderer, all of which
turned a wrong-branch assertion failure into an unrelated crash or a payload
rendered as nothing:

- A value whose property reads throw — a `Proxy` with a hostile `get` trap —
  could escape the renderer's own `catch` via `Object.prototype.toString`.
- A value whose **prototype** cannot be read — a `Proxy` with a throwing
  `getPrototypeOf` trap, or a revoked `Proxy` — escaped one step earlier still,
  before the renderer's `catch` was entered at all. A membrane that revokes on
  teardown leaves exactly this behind, and the assertion asking why threw the
  proxy's `TypeError` instead of the diagnostic.

  Both now render as `[unrenderable object]` (or `[unrenderable function]`).
- A reference cycle running back through a `toJSON` was not detected, because
  `JSON.stringify` makes the `toJSON` result the holder for that node's
  children. The walk recursed until the stack overflowed and the whole payload
  collapsed to `[object Object]`. Such a cycle is now marked `[Circular]` with
  the surrounding structure intact, and a repeated-but-acyclic reference is
  still rendered in full rather than being mistaken for a cycle.

The renderer's single-line guarantee is now honoured for the values that go
through its non-JSON path. An `Error` whose `message` spans lines previously
interpolated those line breaks raw, which broke the `/testing` guard's
one-sentence message and could forge an extra line inside the `✖` block above.
Line breaks in an `Error` message, a symbol description, a function name or a
`Symbol.toStringTag` now render escaped (`\n`, `\r`), with backslashes doubled
so that a real line break stays distinguishable from the literal text `\n` —
the same escaping `JSON.stringify` already applies to a plain string payload.
