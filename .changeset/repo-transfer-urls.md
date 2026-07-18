---
'@zireal/result-kit': patch
---

Point the package metadata at its new home. The repository moved from
`alifarooq-zk/result-kit` to `alifaroo-q/result-kit`, so `repository.url` — which
npm serves and which the provenance attestation binds to — now names the repo
that actually builds the package. `bugs` and `homepage` are added alongside it,
having been absent.

Consumer-visible beyond the registry listing in one place: the `combineWithAllErrors`
JSDoc links to the tracking issue for the accumulated-error formatters, and that link
ships in `dist/index.d.ts` where an editor tooltip resolves it.

No API, runtime, or type change. Every GitHub URL in the repo was rewritten rather
than left to the redirect, which lapses the moment anything is created at the old path.
