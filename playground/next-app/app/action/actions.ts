'use server';

import { BACKEND, relay } from '@/lib/relay';

/**
 * A server action has no response object, so cookies go through Next's cookie store.
 * Note that `relay.forward()` takes no request: there is none to pass here.
 */
export async function login(): Promise<void> {
  const upstream = await fetch(
    `${BACKEND}/backend/set?secure=1&domain=.example.com&samesite=none`,
    await relay.forward(),
  );
  await relay.apply(upstream);
}
