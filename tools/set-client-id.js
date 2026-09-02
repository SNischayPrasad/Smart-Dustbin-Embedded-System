#!/usr/bin/env node
/* ==========================================================================
   Turn on Google sign-in by writing your Client ID into auth-config.js

     node tools/set-client-id.js 1234567890-abcdef.apps.googleusercontent.com

   Validates the format, writes the file, and tells you what to commit.
   Run it with no argument to see the current state.
   ========================================================================== */

const fs   = require("fs");
const path = require("path");

const CONFIG = path.join(__dirname, "..", "website", "assets", "js", "auth-config.js");
const PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

function current(src) {
  const m = src.match(/GOOGLE_CLIENT_ID:\s*"([^"]*)"/);
  return m ? m[1] : null;
}

const src = fs.readFileSync(CONFIG, "utf8");
const id  = (process.argv[2] || "").trim();

if (!id) {
  const now = current(src);
  console.log("");
  console.log("  Current Client ID: " + (now ? now : "(not set - Google sign-in is off)"));
  console.log("");
  console.log("  To set one:");
  console.log("    node tools/set-client-id.js <your-client-id>");
  console.log("");
  console.log("  Get one at https://console.cloud.google.com/apis/credentials");
  console.log("  Create credentials > OAuth client ID > Web application, and add");
  console.log("  these two Authorised JavaScript origins:");
  console.log("      https://snischayprasad.github.io");
  console.log("      http://localhost:3000");
  console.log("");
  process.exit(0);
}

if (id.includes("GOCSPX-") || /^[A-Za-z0-9_-]{24}$/.test(id)) {
  console.error("");
  console.error("  STOP. That looks like a client SECRET, not a Client ID.");
  console.error("  A secret must never be committed. Nothing was written.");
  console.error("");
  console.error("  You want the value ending in .apps.googleusercontent.com");
  console.error("");
  process.exit(1);
}

if (!PATTERN.test(id)) {
  console.error("");
  console.error('  That does not look like a Google Client ID. Expected the form:');
  console.error("      1234567890-abcdefghijklmnop.apps.googleusercontent.com");
  console.error("  Got:");
  console.error("      " + id);
  console.error("");
  console.error("  Nothing was written. Re-run with the correct value.");
  console.error("");
  process.exit(1);
}

const updated = src.replace(/GOOGLE_CLIENT_ID:\s*"[^"]*"/, 'GOOGLE_CLIENT_ID: "' + id + '"');

if (updated === src) {
  console.error("  Could not find GOOGLE_CLIENT_ID in auth-config.js - was it edited by hand?");
  process.exit(1);
}

fs.writeFileSync(CONFIG, updated);

console.log("");
console.log("  Google sign-in is now ON.");
console.log("  Client ID written to website/assets/js/auth-config.js");
console.log("");
console.log("  Check it locally:");
console.log("      node server/server.js      then open http://localhost:3000/login.html");
console.log("");
console.log("  Publish it:");
console.log('      git add website/assets/js/auth-config.js');
console.log('      git commit -m "feat: enable Google sign-in"');
console.log("      git push");
console.log("");
console.log("  Reminder: the Client ID is public and belongs in the repo.");
console.log("  The client SECRET on the same Google page is not used here and");
console.log("  must never be committed.");
console.log("");
