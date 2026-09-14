import { BACKEND, relay } from '@/lib/relay';

/** A pure passthrough route. The whole file is one re-export. */
export const GET = relay.route(`${BACKEND}/backend/set`);
