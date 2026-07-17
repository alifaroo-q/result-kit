import { defineConfig } from 'tsdown';

export default defineConfig({
  // Spec §7.2: exactly two code entrypoints, `.` and `./fluent`. The keys are
  // output paths, so `fluent/index` emits `dist/fluent/index.js` — the path
  // §7.2's `exports` block names. These and `package.json`'s `exports` are
  // updated **together** (CLAUDE.md's new-entrypoint rule); `exports` is
  // hand-authored, so nothing does it for you.
  //
  // Separate entries are also what makes §7.3's boundary enforceable: two
  // entries mean two chunks, and the guard can assert the root chunk contains no
  // wrapper. One entry re-exporting both would erase the differentiator.
  entry: {
    index: 'src/index.ts',
    'fluent/index': 'src/fluent/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2023',
  outDir: 'dist',
  treeshake: true,
  // The package is `"type": "module"`, so let the extension follow the package
  // type: `.js`, not `.mjs`. tsdown defaults this to `true` on `platform: node`,
  // which would force the fixed `.mjs`/`.cjs` pair spec §7.2 does not want.
  fixedExtension: false,
  // `package.json`'s `exports` is hand-authored, not generated. tsdown's
  // generator cannot express spec §7.2's shape: it always collapses `"."` to a
  // bare string (losing the mandated types-first branch), and it offers no way
  // to keep `module` without also emitting `main` — which §7.2 forbids, because
  // a `main` invites a tool to `require()` an ESM file as CJS. publint and attw
  // below still validate the hand-written result on every build.
  exports: false,
  publint: true,
  attw: {
    // tsdown spells this profile kebab-case; the attw *CLI* spells the same
    // profile `esmOnly`. Both mean "ignore CJS resolution failures", which is
    // the right lens for a package that publishes no CJS.
    profile: 'esm-only',
    level: 'error',
  },
});
