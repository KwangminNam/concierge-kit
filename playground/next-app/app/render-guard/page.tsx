import { BACKEND, relay } from '@/lib/relay';

export const dynamic = 'force-dynamic';

/**
 * Writing a cookie during a render is impossible in Next, by design. The relay reports it as
 * unappliable and the page still renders, rather than the request dying.
 */
export default async function RenderGuardPage() {
  const upstream = await fetch(`${BACKEND}/backend/set`, { cache: 'no-store' });
  const result = await relay.apply(upstream);

  return (
    <main>
      <pre id="result">{JSON.stringify(result)}</pre>
    </main>
  );
}
