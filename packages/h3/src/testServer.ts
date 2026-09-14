import { createApp, toNodeListener, type EventHandler } from 'h3';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A real h3 server on an ephemeral port.
 *
 * The h3 adapter needs no mocking: unlike a framework that only exists inside its own runtime,
 * h3 is a plain node listener, so every test here exercises the real thing end to end.
 */
export interface TestServer {
  origin: string;
  close(): void;
}

export async function startHandler(path: string, handler: EventHandler): Promise<TestServer> {
  const app = createApp();
  app.use(path, handler);
  return start(createServer(toNodeListener(app)));
}

export async function startBackend(
  respond: (request: import('node:http').IncomingMessage) => {
    status?: number;
    headers: Record<string, string | string[]>;
    body: string | Buffer;
  },
): Promise<TestServer> {
  const server = createServer((request, response) => {
    const answer = respond(request);
    for (const [name, value] of Object.entries(answer.headers)) response.setHeader(name, value);
    response.statusCode = answer.status ?? 200;
    response.end(answer.body);
  });
  return start(server);
}

async function start(server: Server): Promise<TestServer> {
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}
