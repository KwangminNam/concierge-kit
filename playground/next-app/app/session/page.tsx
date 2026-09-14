import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * A React Server Component cannot write a cookie. It can only read one.
 *
 * What it reads here is whatever the proxy left on the request, which is the point: a token the
 * browser has never sent is already visible to this render.
 */
export default async function SessionPage() {
  const store = await cookies();
  return (
    <main>
      <pre id="seen-by-render">
        {JSON.stringify({ accessToken: store.get('access_token')?.value ?? null })}
      </pre>
    </main>
  );
}
