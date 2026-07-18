---
"@zireal/result-kit": patch
---

Ship `MIGRATION.md` inside the published package.

`README.md` links to it as the upgrade path from 1.x, but `.npmignore` allowed only `dist/`, and npm's automatic inclusions cover just `README.md`, `LICENSE` and `package.json`. The link still resolves on npmjs.com, which rewrites relative links to the repository — so this was never broken for anyone browsing the registry. It was broken for anyone reading the installed package: `node_modules/@zireal/result-kit/MIGRATION.md` did not exist, on the one release where a migration guide matters most.

The tarball goes from 9 files to 10 (+17 kB). No code, types, or exports change.
