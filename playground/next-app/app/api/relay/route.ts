import { BACKEND, rawRelay, relay } from '@/lib/relay';

/** A route handler with logic of its own: call the backend, then hand the answer back. */
export async function GET(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const chosen = incoming.searchParams.get('mode') === 'raw' ? rawRelay : relay;

  const target = new URL('/backend/set', BACKEND);
  incoming.searchParams.forEach((value, key) => {
    if (key !== 'mode') target.searchParams.set(key, value);
  });

  const upstream = await fetch(target, await chosen.forward(request));
  return chosen.respond(upstream, { request });
}
