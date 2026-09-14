/**
 * Node-only entry point of concierge-kit. Kept apart from the main entry so that importing
 * the core on an Edge runtime can never pull in `node:async_hooks`.
 *
 * @see https://concierge-kit.dev/reference/node
 */
export { getRequestSnapshot, runWithRequest, type RelayRequestSnapshot } from './requestContext.js';
