// PROTOTYPE — throwaway. Issue #73.
//
// Every probe is a compile-time assertion. `@ts-expect-error` is the red half:
// if the error stops happening, tsc reports the unused directive, so this file
// fails in both directions. `Expect<Equals<…>>` pins the inferred types,
// including the ones a candidate gets WRONG — those are labelled FINDING.
//
// Run: pnpm exec tsc -p prototype/matchtype-73   (silence = every probe holds)

import { defineError, defineErrors } from '../../src/core/error.ts';
import type { ErrorsOf, TypedError } from '../../src/core/error.ts';
import {
  matchTypeA,
  matchTypeB,
  matchTypeB2,
  matchTypeC,
  matchTypeD,
  matchTypeD2,
  type Equals,
  type Expect,
  type IsAny,
} from './candidates.ts';

/* ------------------------------------------------------------------ *
 * Fixture — a real registry, mixed payload / no-payload variants
 * ------------------------------------------------------------------ */

const notFound = defineError('not_found', (d: { id: string }) => `no ${d.id}`);
const forbidden = defineError('forbidden', 'Access denied');
const conflict = defineError.withData<{ slug: string }>()(
  'conflict',
  'Already exists',
);

const errors = defineErrors({ notFound, forbidden, conflict });
type AppError = ErrorsOf<typeof errors>;

declare const e: AppError;

/* ================================================================== *
 * 1. Exhaustiveness (design B)
 * ================================================================== */

// 1a — all arms present: compiles.
const p1a = matchTypeB(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
  conflict: (v) => v.details!.slug,
});

// 1b — a missing arm is a compile error.
// @ts-expect-error — `conflict` arm missing
matchTypeB(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
});

// 1c — FINDING: B accepts an arm for a tag that is NOT in the union, silently.
// `H extends Arms<E>` is satisfied by a bag with extra keys, and the freshness
// check does not fire against a type parameter. A typo'd tag is a dead arm
// that never runs. Fixed by B2 (§7).
matchTypeB(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
  conflict: (v) => v.details!.slug,
  teapot: () => 'nope',
});

/* ================================================================== *
 * 2. Per-arm narrowing
 * ================================================================== */

matchTypeB(e, {
  not_found: (v) => {
    type _tag = Expect<Equals<typeof v.type, 'not_found'>>;
    type _payload = Expect<Equals<typeof v.details, { id: string } | undefined>>;
    return v.details!.id;
  },
  forbidden: (v) => {
    type _tag = Expect<Equals<typeof v.type, 'forbidden'>>;
    // a no-payload variant is TypedError<'forbidden', never> — `details` is
    // `never | undefined` === `undefined`
    type _payload = Expect<Equals<typeof v.details, undefined>>;
    return 'denied';
  },
  conflict: (v) => {
    // @ts-expect-error — `id` does not exist on the conflict payload
    v.details!.id;
    return v.details!.slug;
  },
});

/* ================================================================== *
 * 3. Return type
 * ================================================================== */

// 3a — FINDING: design A (a naked `U` shared by every arm) is worse than
// §5.3's `match` trap. `U` does not lock to the first candidate and error —
// it does not infer at all. The call compiles and yields `unknown`.
const p3a = matchTypeA(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
  conflict: () => 404,
});
type _p3a = Expect<Equals<typeof p3a, unknown>>;

// 3b — B unions the arm return types.
const p3b = matchTypeB(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
  conflict: () => 404,
});
type _p3b = Expect<Equals<typeof p3b, string | number>>;

// 3c — and the homogeneous case still collapses to one type.
type _p1a = Expect<Equals<typeof p1a, string>>;

/* ================================================================== *
 * 4. No `any` on the result
 * ================================================================== */

type _noAny1 = Expect<Equals<IsAny<typeof p3b>, false>>;
type _noAny2 = Expect<Equals<IsAny<typeof p1a>, false>>;

/* ================================================================== *
 * 5. Default arm
 * ================================================================== */

// 5a — `_` lets a partial bag through, and the result still unions.
const p5a = matchTypeC(e, {
  not_found: (v) => v.details!.id,
  _: () => 'other',
});
type _p5a = Expect<Equals<typeof p5a, string>>;

// 5b — `_` alone is legal: providing it fully relaxes exhaustiveness.
const p5b = matchTypeC(e, {
  _: (v) => v.message,
});
type _p5b = Expect<Equals<typeof p5b, string>>;

// 5c — C's default arm sees the WHOLE union, not the residual.
matchTypeC(e, {
  not_found: () => 'found',
  _: (v) => {
    type _seen = Expect<Equals<typeof v, AppError>>;
    return v.message;
  },
});

// 5d — FINDING: D (residual narrowing with `_` inside the same bag, curried to
// fix the inference order) FAILS. `H` absorbs `_`, the `Exclude` resolves
// against a not-yet-inferred `H`, and the arm lands on `never`.
const p5d = matchTypeD(e)({
  not_found: (v) => v.details!.id,
  _: (v) => {
    type _residual = Expect<Equals<typeof v, never>>;
    return 'unreachable';
  },
});

// 5e — no `_` still requires every arm, through the first overload.
// @ts-expect-error — `conflict` arm missing and no `_`
matchTypeC(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
});

/* ================================================================== *
 * 6. Hazards
 * ================================================================== */

// 6a — an unresolved type parameter (the generic-wrapper case §10.9 punished
// `SettledOr` for). The mapped-type signature does NOT degrade: it stays
// generic and refuses concrete arms, which is the honest answer — an
// unresolved `E` has no known tag set to exhaust.
function wrapper<E extends TypedError>(err: E) {
  return matchTypeB(err, {
    // @ts-expect-error — no concrete arm can satisfy an unresolved `E`
    _unresolved: () => 1,
  });
}

// 6b — a hand-written union (no defineError) behaves identically.
type Manual = TypedError<'a', { n: number }> | TypedError<'b', { s: string }>;
declare const m: Manual;
const p6b = matchTypeB(m, {
  a: (v) => v.details!.n,
  b: (v) => v.details!.s,
});
type _p6b = Expect<Equals<typeof p6b, number | string>>;

// 6c — FINDING: the bare `TypedError` (open `string` tag) maps to an index
// signature, so ANY bag satisfies it — including an empty one, which returns
// `never`. Exhaustiveness is a property of a closed tag union, not of the API.
declare const open: TypedError;
const p6c = matchTypeB(open, { anything: () => 1 });
const p6cEmpty = matchTypeB(open, {});
type _p6cEmpty = Expect<Equals<typeof p6cEmpty, never>>;

/* ================================================================== *
 * 7. Tightened designs
 * ================================================================== */

// 7a — FINDING: A is a non-starter even with homogeneous arms.
const p7a = matchTypeA(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
  conflict: () => 'boom',
});
type _p7a = Expect<Equals<typeof p7a, unknown>>;

// 7b — B2 rejects the stray arm (1c's hole), pointing at the arm itself.
matchTypeB2(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
  conflict: (v) => v.details!.slug,
  // @ts-expect-error — `teapot` is not a variant of AppError
  teapot: () => 'nope',
});

// 7c — B2 keeps narrowing and the unioned return.
const p7c = matchTypeB2(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
  conflict: () => 404,
});
type _p7c = Expect<Equals<typeof p7c, string | number>>;

// 7d — B2 still catches a missing arm.
// @ts-expect-error — `conflict` arm missing
matchTypeB2(e, {
  not_found: (v) => v.details!.id,
  forbidden: () => 'denied',
});

// 7e — D2: residual narrowing DOES work when the fallback is its own
// parameter, so the handler bag's key set is known before it is typed.
const p7e = matchTypeD2(e, { not_found: (v) => v.details!.id }, (v) => {
  type _residual = Expect<
    Equals<
      typeof v,
      TypedError<'forbidden', never> | TypedError<'conflict', { slug: string }>
    >
  >;
  return v.type;
});
type _p7e = Expect<Equals<typeof p7e, string>>;

export {
  p1a,
  p3a,
  p3b,
  p5a,
  p5b,
  p5d,
  p6b,
  p6c,
  p6cEmpty,
  p7a,
  p7c,
  p7e,
  wrapper,
};
