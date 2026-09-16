// Builds site-github.html: the whole site (calculator + library + player) in
// ONE portable HTML file with NO games folder required. The Sparx image is
// embedded as a data URI, the game list is fetched live from the GitHub API
// (repo set below), and games load from raw.githubusercontent.com on click.
// Regenerate after changing the repo name or the cover image:
//   node make-github.mjs
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO = "ublocked-potato/trying"; // owner/repo that holds the games/ folder

const root = process.cwd();
const html = await readFile(resolve(root, "index.html"), "utf8");

// 1) Embed the Sparx image so the file works from anywhere.
const imgPath = resolve(root, "Sparx_Learning_idxcsUMTUc_0.png");
const img = await readFile(imgPath);
const type = "image/png";
const dataUri = "data:" + type + ";base64," + img.toString("base64");

let out = html.replace(
  /<img src="Sparx_Learning_idxcsUMTUc_0\.png"([^>]*)>/,
  (_m, rest) => '<img src="' + dataUri + '"' + rest + ">"
);
if (out === html) {
  console.error("WARNING: image tag not replaced - check the img markup in index.html");
}

// 2) Drop the bundled game list - the GitHub API is the source of truth now.
//    (The list is ~40 KB of filenames; removing it keeps the file tiny.)
const manifestRe = /<script>window\.GAME_FILES=\[[^\]]*\];<\/script>\r?\n?/;
if (!manifestRe.test(out)) {
  console.error("WARNING: bundled GAME_FILES script not found/removed - check index.html");
}
out = out.replace(manifestRe, "");

// 3) Empty the fallback list (previously window.GAME_FILES) and pin the repo.
const listRe = /const GAME_FILES = window\.GAME_FILES \|\| \[\];/;
if (!listRe.test(out)) {
  console.error("WARNING: GAME_FILES declaration not replaced");
}
out = out.replace(listRe, "const GAME_FILES = []; // filled live from the GitHub API");

const repoRe = /var GITHUB_REPO = ""; \/\/ optional "owner\/repo" override if auto-detection fails/;
if (!repoRe.test(out)) {
  console.error("WARNING: GITHUB_REPO line not replaced");
}
out = out.replace(
  repoRe,
  'var GITHUB_REPO = "' + REPO + '"; // single-file build: always this repo'
);

// 4) Games load from raw.githubusercontent.com instead of the local games/ folder.
const fetchRe = /fetch\("games\/" \+ fileName\)/;
if (!fetchRe.test(out)) {
  console.error("WARNING: local game fetch not replaced");
}
out = out.replace(
  fetchRe,
  'fetch("https://raw.githubusercontent.com/' + REPO + '/main/games/" + encodeURIComponent(fileName))'
);

if (out === html) {
  console.error("ERROR: no changes applied - aborting so a wrong file is not written");
  process.exit(1);
}

await writeFile(resolve(root, "site-github.html"), out, "utf8");
console.log("Wrote site-github.html (" + out.length + " bytes)");
console.log("Repo: " + REPO + " | image embedded | bundled list stripped");
