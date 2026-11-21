import { describe, expect, it } from 'vitest';

import { sessionDestination } from '@/features/auth/services/session-destination';

/** A token whose payload is `claims`; header and signature are never read. */
function tokenWith(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');

  return `e30.${payload}.signature`;
}

const CLAIMED = tokenWith({ sub: 'a', organization_id: '00000000-0000-4000-8000-000000000001' });
const CLAIMLESS = tokenWith({ sub: 'a' });

describe('sessionDestination (stories 19.2 and 19.3, AD-24)', () => {
  it('sends a claimed session to the app, whatever its kind', () => {
    expect(sessionDestination({ access_token: CLAIMED, user: { email: 'ivan.maric@dvd.shift.invalid' } })).toBe('app');
    expect(sessionDestination({ access_token: CLAIMED, user: { email: 'ana@example.com' } })).toBe('app');
  });

  it('holds a claimless email identity at setup', () => {
    expect(sessionDestination({ access_token: CLAIMLESS, user: { email: 'ana@example.com' } })).toBe('setup');
    expect(sessionDestination({ access_token: CLAIMLESS, user: { email: ' Ana@Example.COM ' } })).toBe('setup');
  });

  it('signs out a claimless username identity, or an unreadable address (story 19.3, D6)', () => {
    expect(sessionDestination({ access_token: CLAIMLESS, user: { email: 'ivan@dvd.SHIFT.invalid' } })).toBe('signOut');
    expect(sessionDestination({ access_token: CLAIMLESS, user: {} })).toBe('signOut');
    expect(sessionDestination({ access_token: CLAIMLESS, user: { email: 'a@@b' } })).toBe('signOut');
  });

  it('treats an unreadable token as claimless', () => {
    expect(sessionDestination({ access_token: 'not-a-token', user: { email: 'ana@example.com' } })).toBe('setup');
  });
});
