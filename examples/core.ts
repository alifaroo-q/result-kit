/**
 * `@zireal/result-kit` 5.0.0 — a worked example.
 *
 * This file is **type-checked by `pnpm check`** (it is in `tsconfig.json`'s
 * `include`), which is the only thing keeping it honest: an example nobody
 * compiles drifts from the real surface without any command failing.
 *
 * It imports through the **bare specifiers** a consumer uses, not relative
 * paths, so it also proves `@zireal/result-kit` and `@zireal/result-kit/fluent`
 * actually resolve.
 *
 * Read it top to bottom: the fluent wrapper first (the hero), then the
 * free-function core (the lean path), then do-notation, then the error
 * convention.
 */

import {
  andThen,
  combine,
  defineError,
  err,
  isErr,
  isOk,
  map,
  match,
  ok,
  partition,
  safeTry,
  safeUnwrap,
  unwrapOr,
  type Result,
} from '@zireal/result-kit';
import {
  ResultAsync,
  err as ferr,
  from,
  ok as fok,
  safeTry as fsafeTry,
} from '@zireal/result-kit/fluent';

/* -------------------------------------------------------------------------- */
/* The error convention                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `defineError` binds a `type`, a payload type, and a default message, and
 * hands back a constructor producing plain `{ type, message, details? }` values.
 * No classes, nothing extending `Error` — these survive `JSON.stringify`.
 */
const notFound = defineError(
  'not_found',
  (d: { id: string }) => `User ${d.id} not found`,
);
const forbidden = defineError('forbidden', 'Not permitted');
const overdrawn = defineError.withData<{ short: number }>()(
  'overdrawn',
  'Insufficient credit',
);

type NotFound = ReturnType<typeof notFound>;
type Forbidden = ReturnType<typeof forbidden>;
type Overdrawn = ReturnType<typeof overdrawn>;

interface User {
  readonly id: string;
  readonly name: string;
  readonly credit: number;
}

const USERS: readonly User[] = [
  { id: 'u1', name: 'Ada', credit: 120 },
  { id: 'u2', name: 'Grace', credit: 5 },
];

/* -------------------------------------------------------------------------- */
/* Producing Results — the core constructors                                  */
/* -------------------------------------------------------------------------- */

function findUser(id: string): Result<User, NotFound> {
  const user = USERS.find((candidate) => candidate.id === id);

  return user ? ok(user) : err(notFound({ id }));
}

function charge(user: User, amount: number): Result<number, Overdrawn> {
  return user.credit >= amount
    ? ok(user.credit - amount)
    : err(overdrawn({ short: amount - user.credit }));
}

function requireAdmin(user: User): Result<User, Forbidden> {
  return user.name === 'Ada' ? ok(user) : err(forbidden());
}

/* -------------------------------------------------------------------------- */
/* 1. The fluent wrapper — the hero                                           */
/* -------------------------------------------------------------------------- */

/**
 * Chain with zero ceremony, then collapse with a terminal. `.match()` takes both
 * branches, which is what makes it exhaustive by construction — and it is the
 * type-safe way to narrow on this side.
 */
export function greet(id: string): string {
  return from(findUser(id))
    .map((user) => user.name)
    .match({
      ok: (name) => `Hello, ${name}`,
      err: (error) => `No user: ${error.message}`,
    });
}

/**
 * `.andThen()` accumulates the error channel to a union — here
 * `NotFound | Forbidden | Overdrawn` — so nothing is silently widened to
 * `Error` and every failure stays nameable.
 */
export function checkout(id: string, amount: number): Result<number, string> {
  return from(findUser(id))
    .andThen(requireAdmin)
    .andThen((user) => charge(user, amount))
    .mapErr((error) => error.message)
    .toResult();
}

/**
 * `.toResult()` is the documented way out, and the plain union is the only
 * shape the JSON round-trip guarantee covers. The wrapper is a transient
 * envelope — never the interchange type.
 */
export function serialize(id: string): string {
  return JSON.stringify(from(findUser(id)).toResult());
}

/* -------------------------------------------------------------------------- */
/* 2. Async — one await at the front, a terminal at the end                    */
/* -------------------------------------------------------------------------- */

async function loadRemote(id: string): Promise<Result<User, NotFound>> {
  await Promise.resolve();

  return findUser(id);
}

/**
 * `.toAsync()` is the **explicit** sync→async seam. It is explicit on purpose:
 * a settled `Result` cannot promise an asynchronous output, because a transform
 * that short-circuits never runs its callback at all.
 */
export async function displayName(id: string): Promise<string> {
  return ResultAsync.from(loadRemote(id))
    .map((user) => user.name)
    .match({ ok: (name) => name, err: () => 'anonymous' });
}

/** `await` on a `ResultAsync` collapses to the plain union, by design. */
export async function settle(id: string): Promise<Result<User, NotFound>> {
  return await from(findUser(id)).toAsync();
}

/* -------------------------------------------------------------------------- */
/* 3. Do-notation — flat code, early exit                                     */
/* -------------------------------------------------------------------------- */

/**
 * The root runner over plain unions. Each `yield* safeUnwrap(...)` binds its own
 * value type, and any `Err` short-circuits the whole block. The error channel is
 * the union of everything that could fail.
 */
export function checkoutFlat(
  id: string,
  amount: number,
): Result<number, NotFound | Forbidden | Overdrawn> {
  return safeTry(function* () {
    const user = yield* safeUnwrap(findUser(id));
    const admin = yield* safeUnwrap(requireAdmin(user));
    const remaining = yield* safeUnwrap(charge(admin, amount));

    return ok(remaining);
  });
}

/**
 * The same block on the fluent surface. There is **no `safeUnwrap` here** — the
 * wrapper is self-iterable, so you `yield*` it directly — and the runner hands
 * back a wrapper so the chain continues.
 */
export function checkoutFluent(id: string, amount: number): number {
  return fsafeTry(function* () {
    const user = yield* from(findUser(id));

    if (user.credit < 0) return ferr(overdrawn({ short: -user.credit }));

    const remaining = yield* from(charge(user, amount));

    return fok(remaining);
  }).unwrapOr(0);
}

/** Async do-notation: `yield*` a `ResultAsync` with no `await` ceremony. */
export function checkoutRemote(id: string, amount: number): Promise<number> {
  return fsafeTry(async function* () {
    const user = yield* ResultAsync.from(loadRemote(id));
    const remaining = yield* from(charge(user, amount));

    return fok(remaining);
  }).unwrapOr(0);
}

/* -------------------------------------------------------------------------- */
/* 4. The free-function core — the lean, tree-shakable path                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything above is optional sugar. The core is self-sufficient: it never
 * needs `/fluent`, and importing only these three functions is what lets a
 * bundler drop the rest — the thing a class-only library structurally cannot
 * offer.
 */
export function creditAfter(id: string, amount: number): number {
  const charged = andThen(findUser(id), (user) => charge(user, amount));

  return unwrapOr(map(charged, (remaining) => remaining), 0);
}

/**
 * The guards emit real type predicates, so the field access below narrows.
 *
 * Note `details` is **optional** on `TypedError` — the payload is the part a
 * tag-based guard cannot validate at runtime, so the type declines to promise
 * it. `message` is the field that is always there.
 */
export function describe(id: string): string {
  const result = findUser(id);

  if (isOk(result)) return `found ${result.value.name}`;
  if (isErr(result)) return `missing ${result.error.details?.id ?? 'unknown'}`;

  return 'unreachable';
}

/** `match` on the plain union — the same two-branch shape the wrapper has. */
export function label(id: string): string {
  return match(findUser(id), {
    ok: (user) => user.name,
    err: (error) => error.type,
  });
}

/* -------------------------------------------------------------------------- */
/* 5. Collections                                                             */
/* -------------------------------------------------------------------------- */

/** `combine` is all-or-nothing: the first `Err` wins, values keep their tuple. */
export function allUsers(
  ids: readonly string[],
): Result<readonly User[], NotFound> {
  return combine(ids.map(findUser));
}

/** `partition` keeps both halves — it is what v1's two filters each did half of. */
export function splitUsers(ids: readonly string[]): {
  found: readonly User[];
  missing: readonly NotFound[];
} {
  const [found, missing] = partition(ids.map(findUser));

  return { found, missing };
}
