import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type WebServer = {
  /** The URL of `path` under `host`, one of `testHosts` or `localhost`. */
  url(host: string, path: string): string;
  /** The `Host` header of every request served, in order. */
  requestedHosts: string[];
  close(): Promise<void>;
};

/** Serves `pages` (path → HTML) over http on 127.0.0.1, under every host name that reaches it. */
export async function serveWebPages(pages: Record<string, string>): Promise<WebServer> {
  const requestedHosts: string[] = [];
  const server = createServer((request, response) => {
    requestedHosts.push(request.headers.host ?? '');
    const page = pages[request.url ?? ''];
    response.writeHead(page === undefined ? 404 : 200, { 'content-type': 'text/html' });
    response.end(page ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (host, path) => `http://${host}:${String(port)}${path}`,
    requestedHosts,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
