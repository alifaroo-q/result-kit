import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
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
