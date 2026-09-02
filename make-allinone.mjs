// Builds site-all-in-one.html: the ENTIRE site (calculator, Sparx image, game
// library, player, AND every game file) in a single self-contained HTML file.
// Games are gzip-compressed, base64-encoded, split into ~20 MB chunks, and
// spread across multiple <script> blocks so no single script/string exceeds
// browser limits. At runtime a small loader gunzips on demand.
//
// Important: blocks are written to disk with fs.writeSync as they are built
// (never buffered in a WriteStream, never batched via writev) — this volume
// rejects a giant batched write at the 4 GiB mark and this keeps memory tiny.
//
// Usage:
//   node make-allinone.mjs                 -> site-all-in-one.html (full, ~4.2 GB)
//   ALLINONE_SUBSET="2048.html,slope.html" node make-allinone.mjs
//                                          -> site-all-in-one-test.html (smoke test)
//   ALLINONE_OUT=myfile.html node make-allinone.mjs  -> custom output name
import { readFile } from "node:fs/promises";
import { openSync, writeSync, closeSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { resolve, join } from "node:path";

const root = process.cwd();
const htmlPath = resolve(root, "index.html");
const imgPath = resolve(root, "Sparx_Learning_idxcsUMTUc_0.png");
const gamesDir = resolve(root, "games");
const subset = (process.env.ALLINONE_SUBSET || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const outPath = resolve(root, process.env.ALLINONE_OUT || (subset.length ? "site-all-in-one-test.html" : "site-all-in-one.html"));

const CHUNK_SIZE = 20 * 1024 * 1024; // base64 chars per chunk (~15 MB decoded)
const BLOCK_SIZE = 24 * 1024 * 1024; // script text per <script> block
const VERIFY_EVERY = 7; // byte-compare every Nth game during build

// ---------- 1. Template: index.html + embedded image + patched launcher ----------
let html = await readFile(htmlPath, "utf8");
const img = readFileSync(imgPath);
const EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const type = EXT[imgPath.split(".").pop().toLowerCase()] || "application/octet-stream";
const dataUri = "data:" + type + ";base64," + img.toString("base64");
const imgReplaced = html.replace(
  /<img src="Sparx_Learning_idxcsUMTUc_0\.png"([^>]*)>/,
  (_m, rest) => '<img src="' + dataUri + '"' + rest + ">"
);
if (imgReplaced === html) throw new Error("Image tag not found - aborting");
html = imgReplaced;

// Patch the launcher's fetch path to use embedded data when available.
const fetchLine = 'fetch("games/" + fileName)';
if (!html.includes(fetchLine)) throw new Error("fetch line not found - launcher changed?");
html = html.replace(fetchLine, "loadEmbedded(fileName)");

const dropLine = '.then(r => { if (!r.ok) throw new Error("Not found"); return r.blob(); })';
if (!html.includes(dropLine)) throw new Error("then-line not found - launcher changed?");
html = html.replace(dropLine, "");

// ---------- 2. Game list (exact order of the launcher's GAME_FILES) ----------
const mf = html.match(/window\.GAME_FILES=\[([^\]]*)\];/);
if (!mf) throw new Error("GAME_FILES list not found");
const gameFiles = JSON.parse("[" + mf[1] + "]");
const onDisk = new Set(readdirSync(gamesDir));
const missing = gameFiles.filter((f) => !onDisk.has(f));
if (missing.length) throw new Error("Games missing from folder: " + missing.join(", "));
const targets = subset.length ? gameFiles.filter((f) => subset.includes(f)) : gameFiles;
if (subset.length && targets.length !== subset.length) {
  const notFound = subset.filter((f) => !targets.includes(f));
  throw new Error("Subset games not found: " + notFound.join(", "));
}

// ---------- 3. Loader script (defined before the chunk blocks) ----------
const loader = `<script>
window.__GAME_CHUNKS = window.__GAME_CHUNKS || {};
function __GADD(n, c) { (window.__GAME_CHUNKS[n] = window.__GAME_CHUNKS[n] || []).push(c); }
async function loadEmbedded(fileName) {
  var parts = window.__GAME_CHUNKS[fileName];
  if (!parts) { var r = await fetch("games/" + fileName); if (!r.ok) throw new Error("Not found"); return r.blob(); }
  var b64 = parts.join("");
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var blob = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).blob();
  window.__lastEmbedded = fileName;
  return blob;
}
</script>
`;

// ---------- 4. Streamed assembly: head + loader first, then one writeSync per block ----------
const tailIdx = html.lastIndexOf("</body>");
if (tailIdx === -1) throw new Error("</body> not found");
const head = html.slice(0, tailIdx);
const tail = html.slice(tailIdx);

// Remove any stale partial output so offsets start clean.
try { if (statSync(outPath).isFile()) unlinkSync(outPath); } catch {}

const fd = openSync(outPath, "w");
let written = 0;
const write = (s) => {
  const buf = Buffer.from(s, "utf8");
  const n = writeSync(fd, buf);
  if (n !== buf.length) throw new Error("Short write at offset " + written + " (" + n + " of " + buf.length + ")");
  written += n;
};

write(head);
write("\r\n" + loader);

let blockBuf = "";
const flushBlock = () => {
  if (blockBuf) {
    write("<script>" + blockBuf + "</script>\r\n");
    blockBuf = "";
  }
};

let totalRaw = 0;
let totalGz = 0;
let blocks = 0;
let chunks = 0;
let verified = 0;
let fails = 0;
const t0 = Date.now();

for (let i = 0; i < targets.length; i++) {
  const name = targets[i];
  const raw = readFileSync(join(gamesDir, name));
  const gz = gzipSync(raw, { level: 6 });
  const b64 = gz.toString("base64");
  totalRaw += raw.length;
  totalGz += gz.length;

  if (i % VERIFY_EVERY === 0) {
    const back = gunzipSync(Buffer.from(b64, "base64"));
    if (!back.equals(raw)) { fails++; console.error("ROUND-TRIP MISMATCH: " + name); }
    else verified++;
  }

  const key = JSON.stringify(name);
  for (let off = 0; off < b64.length; off += CHUNK_SIZE) {
    const part = b64.slice(off, off + CHUNK_SIZE);
    const line = "__GADD(" + key + "," + JSON.stringify(part) + ");";
    if (blockBuf.length + line.length > BLOCK_SIZE) { flushBlock(); blocks++; }
    blockBuf += line;
    chunks++;
  }
  if ((i + 1) % 10 === 0 || i === targets.length - 1) {
    console.log(
      `[${i + 1}/${targets.length}] ${name} (${(raw.length / 1048576).toFixed(1)} MB -> ${(gz.length / 1048576).toFixed(1)} MB gz, ${Math.round((Date.now() - t0) / 1000)}s, file ${(written / 1073741824).toFixed(2)} GiB)`
    );
  }
}
flushBlock();
blocks++;
write(tail);
closeSync(fd);

console.log("--------------------------------------------------");
console.log("Wrote " + outPath + " (" + (written / 1073741824).toFixed(2) + " GiB)");
console.log(`Games embedded: ${targets.length} of ${gameFiles.length} in manifest`);
console.log(`Raw: ${(totalRaw / 1073741824).toFixed(2)} GiB, gzip: ${(totalGz / 1073741824).toFixed(2)} GiB (ratio ${(totalGz / totalRaw * 100).toFixed(0)}%)`);
console.log(`Script blocks: ${blocks}, chunks: ${chunks}`);
console.log(`Round-trip verified: ${verified} games, mismatches: ${fails}`);
console.log(`Elapsed: ${Math.round((Date.now() - t0) / 1000)}s`);