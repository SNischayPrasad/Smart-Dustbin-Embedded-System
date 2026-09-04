#!/usr/bin/env node
/* ==========================================================================
   Cache-bust the site's own CSS and JS.

     node tools/bump-assets.js

   GitHub Pages serves assets with a cache lifetime, so after a push a
   browser will happily keep running yesterday's JavaScript - which looks
   exactly like the fix not working. Stamping a version onto each local
   asset URL makes the path change whenever the content does, so the browser
   is obliged to refetch.

   Only same-origin assets are touched. CDN URLs are left alone: they are
   already versioned in the path and are meant to be cached hard.
   ========================================================================== */

const fs   = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "website");
const pages = fs.readdirSync(WEB).filter(f => f.endsWith(".html"));

/* A version that changes whenever the assets do. Content-derived would be
   ideal; the commit count is simpler, always increases, and is enough. */
let version;
try {
  version = require("child_process")
    .execSync("git rev-list --count HEAD", { cwd: path.join(__dirname, "..") })
    .toString().trim();
} catch (e) {
  version = String(Date.now());
}

let changed = 0;

pages.forEach(function (file) {
  const p = path.join(WEB, file);
  let s = fs.readFileSync(p, "utf8");
  const before = s;

  /* src="assets/..." and href="assets/..." - strip any old ?v= first. */
  s = s.replace(/(\s(?:src|href)=")(assets\/[^"?]+)(\?v=[^"]*)?(")/g,
                function (_, a, url, _old, b) { return a + url + "?v=" + version + b; });

  if (s !== before) {
    fs.writeFileSync(p, s);
    changed++;
    console.log("  stamped " + file);
  }
});

console.log("\n  version " + version + " applied to " + changed + " page(s)");
console.log("  commit and push, and browsers will refetch every asset.\n");
