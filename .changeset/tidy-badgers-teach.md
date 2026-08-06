---
'@zireal/result-kit': minor
---

Ship the AI-agent adoption kit — `llms.txt`, `llms-full.txt`, and an installable Agent Skill.

No API change: this release adds documentation aimed at the coding agents that now write most `Result` boilerplate. All three artifacts ship **inside the tarball**, because an agent working in your repo sees `node_modules/@zireal/result-kit/`, not GitHub — a kit reachable only by URL is a kit that never loads.

| File | What it is |
|---|---|
| `llms.txt` | A self-contained brief: the API surface, the `TypedError` convention, and the gotchas. |
| `llms-full.txt` | The long form — wire story, do-notation, `fromSchema`, recipes, migration, rationale. |
| `skills/using-result-kit/SKILL.md` | An Agent Skill that loads on demand while the agent writes `Result` code. |

```bash
cp -r node_modules/@zireal/result-kit/skills/using-result-kit .claude/skills/
```

Both briefs lead with a **wrong→right table** rather than a tour of the API. That is the deliberate shape: models reach for `neverthrow` from training priors, and the two libraries are close enough to look interchangeable — `result.map(f)` for `map(result, f)`, `.match(okFn, errFn)` for `match(r, { ok, err })`, `Result.combine` for `combine`, `_unsafeUnwrap` for `unwrapOrThrow`, and `.isOk()` assumed to narrow when `/fluent`'s returns a plain boolean. Teaching the correct API without naming the reflex leaves the reflex in place.

`llms.txt` is a **hand-written distillation, not the llmstxt.org link index**. The spec form is a list of links, which teaches an agent nothing until it fetches — and the reader this exists for is usually reading from `node_modules/` with no network.

The cost of hand-authoring is silent drift, so the load-bearing half is pinned by a test (`test/docs/agent-kit.spec.ts`) rather than by review: every root export must appear in both briefs, and the export counts they state out loud must be true. Proved red against a simulated new export before landing.
