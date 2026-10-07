// Serves corpus/fixtures on localhost:<port>. 127.0.0.1:<port> is a different
// origin, which the iframe fixture uses for its cross-origin frame.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export function serveFixtures(port = 8123) {
  return http
    .createServer((req, res) => {
      const file = path.join("corpus/fixtures", new URL(req.url, "http://x").pathname);
      if (!existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(file));
    })
    .listen(port);
}
