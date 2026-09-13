// A static file server for the browser-driven quality probes.
//
// Both probes need a real HTTP origin rather than `file://`: `@layer` and
// `content-visibility` behave the same either way, but the theme fetches
// `/data/catalog/catalog.json` at runtime and a `file://` page cannot.
// Shared by `scripts/quality-css-cascade.mjs` and
// `scripts/quality-view-switch.mjs`, so both probes serve the built site the
// same way a static host would.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".md": "text/markdown",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

/**
 * Serve `dir` on an ephemeral loopback port. Resolves to the listening
 * server — read `server.address().port`, and `close()` it when done.
 */
export function serve(dir) {
  const server = createServer(async (req, res) => {
    let path = decodeURI(req.url.split("?")[0]);
    if (path.endsWith("/")) path += "index.html";
    if (!extname(path)) path += ".html";
    try {
      const body = await readFile(join(dir, path));
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
