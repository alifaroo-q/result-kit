// PROTOTYPE — throwaway. The call-site battery for issue #17.
//
// This encodes the LOCKED signature (hybrid single-call + curried `.withData`,
// message always required, `.is()` shipped). A clean `tsc --noEmit` over this
// file IS the proof: every `Expect<Equal<...>>` asserts inference, and every
// `@ts-expect-error` asserts a forbidden call actually fails to compile.

import { defineError, type TypedError } from './define-error';

// --- tiny type-equality harness ---
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// =============================================================================
// 1. Single-call form — payload variant, message derived from payload (common)
// =============================================================================
const notFound = defineError('not_found', (d: { id: string }) => `User ${d.id} not found`);

// Question 3: ReturnType is the clean typed variant, no Record<string, unknown> leak.
type _1 = Expect<
  Equal<ReturnType<typeof notFound>, TypedError<'not_found', { id: string }>>
>;

notFound({ id: '123' });                    // details required, message from default fn
notFound({ id: '123' }, 'Custom override'); // per-call message override

// @ts-expect-error — payload is required for a payload variant
notFound();
// @ts-expect-error — payload shape is enforced
notFound({ nope: 1 });
// @ts-expect-error — message fn param must be annotated (that IS the payload declaration)
defineError('bad', (d) => `${d.id}`);

// =============================================================================
// 2. Single-call form — no-payload variant, static message
// =============================================================================
const forbidden = defineError('forbidden', 'Access denied');

// Question 3: payload is `never`, NOT Record<string, unknown> — no leak.
type _2 = Expect<
  Equal<ReturnType<typeof forbidden>, TypedError<'forbidden', never>>
>;

forbidden();               // message from default
forbidden('You may not');  // message override, first positional (no payload slot)

// @ts-expect-error — a no-payload variant takes no payload object
forbidden({ id: '1' });

// =============================================================================
// 3. Message is ALWAYS required — never fully omittable
// =============================================================================
// @ts-expect-error — a default message is mandatory
defineError('timeout');

// =============================================================================
// 4. `.withData` — payload + STATIC message, payload type given without repeat
// =============================================================================
const conflict = defineError.withData<{ id: string }>()('conflict', 'Already exists');
type _4 = Expect<
  Equal<ReturnType<typeof conflict>, TypedError<'conflict', { id: string }>>
>;
conflict({ id: '9' });
conflict({ id: '9' }, 'override');

// `.withData` also carries a fn message (param typed from the explicit <{ id }>):
const conflict2 = defineError.withData<{ id: string }>()(
  'conflict',
  (d) => `Conflict on ${d.id}`,
);
type _4b = Expect<
  Equal<ReturnType<typeof conflict2>, TypedError<'conflict', { id: string }>>
>;

// =============================================================================
// 5. Building an error union from constructor return types (ADR 0002 §5)
// =============================================================================
type ApiError = ReturnType<typeof notFound> | ReturnType<typeof forbidden>;

// =============================================================================
// 6. Question 4 — the per-variant `.is()` guard narrows a union
// =============================================================================
function handle(err: ApiError): string {
  if (notFound.is(err)) {
    // narrowed to the not_found variant — payload access is typed
    return `404: ${err.details?.id ?? '?'}`;
  }
  return `403: ${err.message}`;
}
void handle;

// Bind assertions so nothing is unused.
export const _assertions = [
  null as unknown as _1,
  null as unknown as _2,
  null as unknown as _4,
  null as unknown as _4b,
];
