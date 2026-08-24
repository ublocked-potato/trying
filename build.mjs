// Cloudflare Pages build script.
// Scans the /games folder and bundles the file list DIRECTLY into
// index.html (the single merged site: calculator cover + game
// library) as a JavaScript variable (window.GAME_FILES) - there is
// no standalone config file left on the site. Drop new .html/.htm
// files into /games and they appear on the next deploy. Typing 000
// on the calculator swaps to the game library without navigating,
// so the URL never changes.
//
// On Cloudflare (CF_PAGES=1) every inline <script> block is also
// minified with terser, so the deployed page is far harder to read
// in the browser's developer tools.
//
// Local runs (no CF_PAGES) only refresh the bundled list and keep
// main.html readable, so the file stays easy to edit by hand.
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// terser >= 5.50 exposes minify_sync for synchronous use (minify is async now).
import { minify_sync as minify } from "terser";

const root = dirname(fileURLToPath(import.meta.url));
const gamesDir = resolve(root, "games");
const indexFile = resolve(root, "index.html");

// Cloudflare Pages serves a single asset up to 25 MiB.
const PAGES_FILE_LIMIT = 25 * 1024 * 1024;
const ON_CLOUDFLARE = process.env.CF_PAGES === "1";

const outArg = process.argv.indexOf("--out");
const outFile =
  outArg !== -1 && process.argv[outArg + 1]
    ? resolve(root, process.argv[outArg + 1])
    : indexFile;

const games = (await readdir(gamesDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(html?|HTML?)$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort();

// Read main.html and normalize line endings for safe editing.
let html = await readFile(indexFile, "utf8");
const hadCRLF = html.includes("\r\n");
if (hadCRLF) html = html.replace(/\r\n/g, "\n");

// 1) Bundle the game list into main.html as a JS variable.
//    (Filenames never contain ";" or "]", so this match is exact.)
const manifestRe = /window\.GAME_FILES\s*=\s*[^;]*;/;
if (!manifestRe.test(html)) {
  throw new Error(
    'index.html is missing "window.GAME_FILES = [...]" - add <script>window.GAME_FILES=[];</script> to the head.'
  );
}
html = html.replace(manifestRe, "window.GAME_FILES=" + JSON.stringify(games) + ";");

// 2) On Cloudflare, minify every inline <script> block with terser.
if (ON_CLOUDFLARE) {
  html = await minifyInlineScripts(html);
  console.log("Minified all inline scripts with terser.");
}

// Restore CRLF so the file keeps its original line-ending convention.
if (hadCRLF) html = html.replace(/\n/g, "\r\n");

await writeFile(outFile, html, "utf8");
console.log(
  "Bundled " +
    games.length +
    " games into " +
    (ON_CLOUDFLARE ? "(minified) " : "") +    "index.html."
  );

// Warn about files Cloudflare Pages will reject at upload.
const oversized = [];
for (const name of games) {
  const size = (await stat(resolve(gamesDir, name))).size;
  if (size > PAGES_FILE_LIMIT) {
    oversized.push(name + " (" + (size / 1024 / 1024).toFixed(1) + " MiB)");
  }
}
if (oversized.length > 0) {
  console.warn(
    "\nWARNING: " +
      oversized.length +
      " file(s) exceed Cloudflare Pages' 25 MiB per-file limit:\n  " +
      oversized.join("\n  ")
  );
}

// Minifies the content of every inline <script> (no src=) block in the page.
async function minifyInlineScripts(html) {
  return html.replace(
    /<script(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi,
    (block) => {
      const open = block.match(/^<script[^>]*>/i)[0];
      const code = block.slice(open.length, block.length - "</script>".length);
      const result = minify(code, { compress: true, mangle: false });
      if (result.error) throw result.error;
      return open + result.code + "</script>";
    }
  );
}
