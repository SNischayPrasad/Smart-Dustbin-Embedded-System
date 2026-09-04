#!/usr/bin/env node
/* ==========================================================================
   Confirm that the owner list in firebase-config.js matches the one in
   firestore.rules.

     node tools/check-owners.js

   These two lists have to agree, and nothing enforces that automatically.
   The page reads the config; the database reads the rules. If they drift,
   an owner is offered the management screen and then refused on every
   write - which reads as a bug rather than a missing edit, and is exactly
   the kind of thing that eats an afternoon.
   ========================================================================== */

const fs   = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const cfgSrc = fs.readFileSync(path.join(root, "website/assets/js/firebase-config.js"), "utf8");
const rules  = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

global.FIREBASE_CONFIG = null;
eval(cfgSrc.replace("const FIREBASE_CONFIG", "var FIREBASE_CONFIG"));

const fromConfig = (FIREBASE_CONFIG.OWNER_UIDS || [FIREBASE_CONFIG.OWNER_UID])
  .map(u => String(u || "").trim()).filter(Boolean).sort();

/* Only look inside ownerUids(), so a UID mentioned in a comment elsewhere
   does not count as configured. */
const block = rules.match(/function ownerUids\(\)\s*\{[\s\S]*?\}/);
const fromRules = block
  ? [...block[0].matchAll(/'([A-Za-z0-9]{20,40})'/g)].map(m => m[1]).sort()
  : [];

const same = JSON.stringify(fromConfig) === JSON.stringify(fromRules);

console.log("");
console.log("  firebase-config.js : " + (fromConfig.join(", ") || "(none)"));
console.log("  firestore.rules    : " + (fromRules.join(", ") || "(none)"));
console.log("");

if (same && fromConfig.length) {
  console.log("  OK - " + fromConfig.length + " owner(s), both lists agree.");
  console.log("  Remember the rules only take effect once Published in the");
  console.log("  Firebase console.\n");
  process.exit(0);
}

if (!fromConfig.length && !fromRules.length) {
  console.log("  No owners configured anywhere.\n");
  process.exit(1);
}

console.log("  MISMATCH - these lists must be identical.");
fromConfig.filter(u => !fromRules.includes(u))
  .forEach(u => console.log("    in the config but NOT in the rules: " + u));
fromRules.filter(u => !fromConfig.includes(u))
  .forEach(u => console.log("    in the rules but NOT in the config: " + u));
console.log("");
process.exit(1);
