// PROTOTYPE — throwaway. Runtime surface for issue #17.
// Run:  pnpm exec vitest run prototype/define-error/demo.test.ts
// Prints the ACTUAL values each candidate produces so we can eyeball the objects,
// not just the types.

import { describe, expect, it } from 'vitest';
import { defineError } from './define-error';

const show = (label: string, value: unknown) =>
  console.log(`\n${label}\n${JSON.stringify(value, null, 2)}`);

describe('defineError — produced values', () => {
  it('Candidate A: payload variant, default + override message', () => {
    const notFound = defineError(
      'not_found',
      (d: { id: string }) => `User ${d.id} not found`,
    );
    show('A · notFound({ id: "123" })', notFound({ id: '123' }));
    show("A · notFound({ id: '123' }, 'Custom')", notFound({ id: '123' }, 'Custom'));

    expect(notFound({ id: '123' })).toEqual({
      type: 'not_found',
      message: 'User 123 not found',
      details: { id: '123' },
    });
    expect(notFound({ id: '123' }, 'Custom').message).toBe('Custom');
  });

  it('single-call: no-payload variant, static message + override', () => {
    const forbidden = defineError('forbidden', 'Access denied');

    show('· forbidden()', forbidden());
    show("· forbidden('You may not')", forbidden('You may not'));

    expect(forbidden()).toEqual({ type: 'forbidden', message: 'Access denied' });
    expect(forbidden('You may not').message).toBe('You may not');
  });

  it('.withData: payload + static message', () => {
    const conflict = defineError.withData<{ id: string }>()('conflict', 'Already exists');
    show("· conflict({ id: '7' })", conflict({ id: '7' }));
    expect(conflict({ id: '7' })).toEqual({
      type: 'conflict',
      message: 'Already exists',
      details: { id: '7' },
    });
  });

  it('Question 4: per-variant .is() narrows a union at runtime', () => {
    const notFound = defineError('not_found', (d: { id: string }) => `User ${d.id}`);
    const forbidden = defineError('forbidden', 'Access denied');

    const errs = [notFound({ id: '1' }), forbidden()] as const;
    expect(errs.filter((e) => notFound.is(e))).toHaveLength(1);
    expect(notFound.is(forbidden())).toBe(false);
    expect(notFound.is({ type: 'not_found', message: 'x' })).toBe(true); // tag-only
  });
});
