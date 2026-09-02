// Builds site-single.html: the whole site software (calculator, Sparx image,
// game library, player) in ONE self-contained HTML file. The only thing it
// still needs at runtime is the games/ folder (2.6 GB of game files), which
// cannot realistically be baked into a single document.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const htmlPath = resolve(root, "index.html");
const imgPath = resolve(root, "Sparx_Learning_idxcsUMTUc_0.png");
const outPath = resolve(root, "site-single.html");

const html = await readFile(htmlPath, "utf8");
const img = await readFile(imgPath);
const EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const ext = imgPath.split(".").pop().toLowerCase();
const type = EXT[ext] || "application/octet-stream";
const dataUri = "data:" + type + ";base64," + img.toString("base64");

// The alt/class/onerror stay; src becomes the embedded data URI.
let out = html.replace(
  /<img src="Sparx_Learning_idxcsUMTUc_0\.png"([^>]*)>/,
  (_m, rest) => '<img src="' + dataUri + '"' + rest + ">"
);

if (out === html) {
  console.error("WARNING: image tag not replaced - check the img markup in index.html");
}

await writeFile(outPath, out, "utf8");
console.log("Wrote " + outPath);
console.log("Image embedded: " + (out.length - html.length) + " bytes added (base64)");