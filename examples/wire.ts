/**
 * `@zireal/result-kit` 5.0.0 — a `Result` across the wire.
 *
 * This file is **type-checked by `pnpm check`** (it is in `tsconfig.json`'s
 * `include`), and it holds the substance that `README.md`'s *Across the wire*
 * section and `RECIPES.md`'s wire recipe quote. Those documents make a claim
 * about types surviving a boundary; an uncompiled snippet is the weakest
 * possible form of that claim, so the claim lives here instead.
 *
 * It imports through the **bare specifiers** a consumer uses, so it also proves
 * `@zireal/result-kit` actually resolves.
 *
 * **There is no framework here, on purpose.** Everything below is plain
 * TypeScript over values that survive `JSON.stringify` — spec §2.1's floor,
 * which every transport honours: a server action, an RPC handler, a route
 * handler, `fetch`, a worker `postMessage`. The framework-specific part of the
 * pattern is a directive and a signature (see `docs`-side recipe); the
 * substance is here, where it compiles.
 *
 * Read it in order: the contract both sides share, the server half, then the
 * two client halves — one where the type crosses with the value, one where it
 * does not.
 */

import { z } from 'zod';

import {
  defineError,
  defineErrors,
  err,
  fromSchema,
  isErr,
  isOk,
  matchType,
  ok,
  parseResult,
  type ErrorsOf,
  type Result,
  type ValidationFailed,
} from '@zireal/result-kit';

/* -------------------------------------------------------------------------- */
/* 1. The contract — shared by both sides of the boundary                     */
/* -------------------------------------------------------------------------- */

/**
 * The one module both halves import. Nothing here is server-only or
 * client-only: a schema, an error vocabulary, and a payload type.
 *
 * This is what "no codegen" means concretely — the client's types are the
 * server's types because they are *the same declarations*, not a generated
 * mirror of them kept in sync by a build step.
 */
const BookingInput = z.object({
  seatId: z.string().min(1),
  passengerEmail: z.email(),
});

interface Booking {
  readonly id: string;
  readonly seatId: string;
}

/**
 * `defineErrors` groups the constructors so the union derives with `ErrorsOf`
 * rather than being restated. The union is the client's exhaustiveness source.
 */
const seatTaken = defineError(
  'seat_taken',
  (d: { seatId: string }) => `Seat ${d.seatId} is already booked`,
);
const flightClosed = defineError(
  'flight_closed',
  'Check-in has closed for this flight',
);

const bookingErrors = defineErrors({ seatTaken, flightClosed });

/**
 * `ValidationFailed` is in the union because validation happens **server-side**
 * and its failure is reported like any other — one error channel, not a
 * separate "bad request" path the client has to remember to check.
 */
type BookingError = ErrorsOf<typeof bookingErrors> | ValidationFailed;

/* -------------------------------------------------------------------------- */
/* 2. The server half — one `Result`-returning function                        */
/* -------------------------------------------------------------------------- */

const parseBookingInput = fromSchema(BookingInput);

const TAKEN_SEATS = new Set(['12A']);

/**
 * The whole server-side story, and the only function either transport calls.
 *
 * It takes `unknown` because that is what actually arrives at a boundary, and
 * it validates before it trusts. Every failure — malformed input included — is
 * a value in the error channel, so nothing here throws and nothing depends on a
 * framework's opinion about what to do with a thrown error.
 */
export async function createBooking(
  input: unknown,
): Promise<Result<Booking, BookingError>> {
  const parsed = parseBookingInput(input);

  if (isErr(parsed)) return parsed;

  const { seatId } = parsed.value;

  if (TAKEN_SEATS.has(seatId)) return err(bookingErrors.seatTaken({ seatId }));

  await Promise.resolve();

  return ok({ id: 'bk_1', seatId });
}

/**
 * Rendering the failure. Exhaustive by construction: add a variant to
 * `BookingError` and this stops compiling until it is given a message.
 *
 * It runs on **either** side — the error is plain data, so the same function
 * works in a route handler and in a React component.
 */
export function explain(error: BookingError): string {
  return matchType(error, {
    seat_taken: (e) => `Pick another seat — ${e.details?.seatId ?? 'that one'} is gone.`,
    flight_closed: (e) => e.message,
    validation_failed: (e) =>
      (e.details?.issues ?? [])
        .map(({ path, message }) => `${path.join('.') || 'input'}: ${message}`)
        .join('\n'),
  });
}

/* -------------------------------------------------------------------------- */
/* 3. Client half A — the type crosses with the value                          */
/* -------------------------------------------------------------------------- */

/**
 * A server action, an RPC client, a typed worker channel: the transport carries
 * the return *type* along with the value, so the client already has
 * `Result<Booking, BookingError>` and there is nothing to parse.
 *
 * Modelled here as a declaration, because the binding is the framework's to
 * produce. In Next.js this is the imported `'use server'` function; the action
 * itself is a one-line wrapper over `createBooking` above.
 */
declare const bookSeatAction: (
  input: unknown,
) => Promise<Result<Booking, BookingError>>;

/**
 * The payoff, and the reason the boundary is worth crossing this way: the error
 * is **narrowed**, not a `string` and not an `unknown` caught from a `try`.
 * `matchType` sees the real union on the client.
 */
export async function bookViaAction(input: unknown): Promise<string> {
  const result = await bookSeatAction(input);

  return isOk(result) ? `Booked ${result.value.seatId}` : explain(result.error);
}

/* -------------------------------------------------------------------------- */
/* 4. Client half B — the type is lost, so prove it back                       */
/* -------------------------------------------------------------------------- */

/**
 * Over `fetch`, `response.json()` is `unknown` and the return type did not come
 * with it. This is the half that needs `parseResult`, and the only difference
 * between the two clients.
 *
 * Two steps, deliberately separate:
 *
 *   1. `parseResult` proves the **envelope** — this is a `Result` at all.
 *   2. A schema (or a guard) proves the **payload** — `parseResult` leaves both
 *      halves `unknown` and takes no generic, because the envelope is provable
 *      and what it carries is not.
 *
 * Skipping either one is `as Result<Booking, BookingError>`: an assertion
 * nothing verifies, on data you did not author.
 */
const parseBooking = fromSchema(z.object({ id: z.string(), seatId: z.string() }));

export async function bookViaFetch(input: unknown): Promise<string> {
  const response = await fetch('/api/bookings', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  const envelope = parseResult(await response.json());

  // The response was not a `Result` — a proxy error page, a truncated body, a
  // gateway that rewrote the shape. Distinct from a booking that failed.
  if (isErr(envelope)) {
    return `Bad response from /api/bookings (${envelope.error.details?.reason})`;
  }

  const result = envelope.value; // Result<unknown, unknown>

  if (isErr(result)) return renderUnknownError(result.error);

  const booking = parseBooking(result.value);

  return isOk(booking) ? `Booked ${booking.value.seatId}` : 'Unrecognized booking';
}

/**
 * The error half needs proving too, and a tag check is enough — the client only
 * has to recognize the vocabulary it knows how to render.
 */
function renderUnknownError(error: unknown): string {
  const isKnown =
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error.type === 'seat_taken' ||
      error.type === 'flight_closed' ||
      error.type === 'validation_failed');

  return isKnown ? explain(error as BookingError) : 'Booking failed';
}

/* -------------------------------------------------------------------------- */
/* 5. The one thing that does not cross                                        */
/* -------------------------------------------------------------------------- */

/**
 * `cause` is the single field in the four-field `TypedError` shape that carries
 * `unknown`, so it is the one place a non-serializable value can enter a
 * `Result` that is otherwise provably JSON-safe.
 *
 * `fromSchema`'s `{ includeCause: true }` puts the **raw vendor issues** there —
 * the rejected input included. That is a debugging aid on the server and a
 * liability on the wire: it can carry a cycle, a `BigInt`, or a user's password
 * straight into the response body.
 *
 * So strip it at the boundary. This is a server-side concern and it belongs in
 * one place — the function that serializes.
 */
export function forTransport<T, E extends { readonly cause?: unknown }>(
  result: Result<T, E>,
): Result<T, Omit<E, 'cause'>> {
  if (isOk(result)) return result;

  const { cause: _dropped, ...rest } = result.error;

  return err(rest);
}
