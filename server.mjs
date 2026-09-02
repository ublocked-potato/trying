// Minimal static file server for local preview / development.
// Serves the project root on PORT (default 8080). No dependencies.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
// Some environments export PORT=0 ("any free port"); that defeats a stable
// preview URL, so only honor PORT when it is a real positive port number.
const portEnv = Number(process.env.PORT);
const port = Number.isInteger(portEnv) && portEnv > 0 ? portEnv : 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let filePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    filePath = normalize(filePath);
    const abs = resolve(root, filePath);

    // Refuse anything outside the project root.
    if (!abs.startsWith(root + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    let info;
    try {
      info = await stat(abs);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("404 Not Found");
      return;
    }

    if (info.isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("404 Not Found");
      return;
    }

    const type = MIME[extname(abs).toLowerCase()] || "application/octet-stream";
    const data = await readFile(abs);
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("500 " + err.message);
  }
}).listen(port, () => {
  console.log("Static server running at http://localhost:" + port);
});
