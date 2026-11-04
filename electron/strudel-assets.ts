import { app } from "electron";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

// Only the separately built, unprivileged Strudel frame is served here.
// Its HTTP origin differs from the credentialed file:// application.
export async function serveStrudel(pathname: string, res: ServerResponse): Promise<void> {
  const root = resolve(app.getAppPath(), "dist/strudel");
  try {
    const file = resolve(root, decodeURIComponent(pathname.slice("/strudel/".length)) || "index.html");
    const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
    if (!file.startsWith(root + sep) || !mime[extname(file)]) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.setHeader("Content-Type", mime[extname(file)]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https: data: blob:; media-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors file: http://localhost:1420 http://127.0.0.1:1420");
    res.end(data);
  } catch { res.writeHead(404).end(); }
}
