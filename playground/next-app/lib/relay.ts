import { createRelay } from '@concierge-kit/next';

/** Where this server reaches the fake backend. Inside a container this is not the public origin. */
export const BACKEND = process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:3100';

/**
 * The policy a real application would declare: only session cookies travel, and the
 * environment rules fix the attributes that would otherwise make the browser drop them.
 */
export const relay = createRelay({
  cookie: {
    allow: ['access_token', 'refresh_token'],
    domain: 'auto',
    secure: 'auto',
    sameSite: 'auto',
  },
  forward: { cookies: ['access_token', 'refresh_token'] },
  onUnappliable: 'warn',
});

/**
 * A deliberately naive relay used by the end to end suite as the control case: it copies the
 * backend cookie exactly as it arrived. The browser then rejects it, silently, which is the
 * bug this package exists to remove.
 */
export const rawRelay = createRelay({
  cookie: { allow: true, domain: 'keep', secure: 'keep', sameSite: 'keep' },
  forward: { cookies: true },
});
