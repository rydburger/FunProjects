// =========================================================
// Error Correction Zoo Tycoon — artifact bundler (a publishing helper,
// not part of the game: the game itself has no build step).
//
// Writes self-contained copies of the two pages, with zoo.css and every
// <script src> inlined, for publishing as a claude.ai artifact:
//   node quantum-games/qec-zoo-tycoon/bundle-artifact.js <out-dir>
// produces <out-dir>/zoo-tycoon.html (the park; the html/head/body
// skeleton is dropped because the artifact host adds its own) and
// <out-dir>/sandbox.html (a full document, published as a supporting
// file next to it, so the park's "sandbox.html" links keep working).
// =========================================================
var fs = require("fs"), path = require("path");
var dir = __dirname, out = process.argv[2];
if (!out) { console.error("usage: node bundle-artifact.js <out-dir>"); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
function inline(file, keepSkeleton) {
  var html = fs.readFileSync(path.join(dir, file), "utf8");
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (_, f) {
    return "<style>\n" + fs.readFileSync(path.join(dir, f), "utf8") + "\n</style>";
  });
  html = html.replace(/<script src="([^"]+)"><\/script>/g, function (_, f) {
    return "<script>\n" + fs.readFileSync(path.join(dir, f), "utf8").replace(/<\/script/gi, "<\\/script") + "\n</script>";
  });
  if (!keepSkeleton) {
    html = html.replace(/<!doctype html>\s*/i, "").replace(/<\/?html[^>]*>\s*/g, "")
      .replace(/<\/?head>\s*/g, "").replace(/<\/?body>\s*/g, "")
      .replace(/<meta charset="utf-8">\s*/, "").replace(/<meta name="viewport"[^>]*>\s*/, "");
  }
  return html;
}
fs.writeFileSync(path.join(out, "zoo-tycoon.html"), inline("index.html", false));
fs.writeFileSync(path.join(out, "sandbox.html"), inline("sandbox.html", true));
console.log("wrote " + path.join(out, "zoo-tycoon.html") + " and " + path.join(out, "sandbox.html"));
