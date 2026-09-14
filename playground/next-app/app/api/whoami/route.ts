import { BACKEND, relay } from '@/lib/relay';

/** Proves the other direction: which of the browser cookies reached the backend. */
export async function GET(request: Request): Promise<Response> {
  const upstream = await fetch(`${BACKEND}/backend/echo`, await relay.forward(request));
  return relay.respond(upstream, { request });
}
