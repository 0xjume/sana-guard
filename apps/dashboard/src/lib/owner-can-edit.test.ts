import { describe, expect, it } from 'vitest';
import { ownerCanEdit } from './owner-can-edit';

describe('ownerCanEdit', () => {
  const owner = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';

  it('is false until the session is ready so the real owner is never treated as a visitor', () => {
    expect(ownerCanEdit({ ready: false, owner }, owner)).toBe(false);
  });

  it('is true only for the matching owner after the session is ready', () => {
    expect(ownerCanEdit({ ready: true, owner }, owner)).toBe(true);
    expect(
      ownerCanEdit({ ready: true, owner: 'Other111111111111111111111111111111111111111' }, owner)
    ).toBe(false);
    expect(ownerCanEdit({ ready: true, owner: null }, owner)).toBe(false);
  });
});
