#!/usr/bin/env node
/* ==========================================================================
   Confirm that firebase-config.js and firestore.rules agree about who is
   who: the owners, the collection crew, and any real hardware.

     node tools/check-owners.js

   These lists have to agree, and nothing enforces that automatically.
   The page reads the config; the database reads the rules. If they drift,
   an owner is offered the management screen and then refused on every
   write - which reads as a bug rather than a missing edit, and is exactly
   the kind of thing that eats an afternoon.

   The crew and device lists are allowed to be empty on BOTH sides: those
   accounts do not exist until someone creates them in the Firebase console.
   Empty on one side only is a mismatch, and the loudest kind - it means
   either the page is offering something the database will refuse, or the
   database is trusting a UID the page has never heard of.
   ========================================================================== */

const fs   = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const cfgSrc = fs.readFileSync(path.join(root, "website/assets/js/firebase-config.js"), "utf8");
const rules  = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

global.FIREBASE_CONFIG = null;
eval(cfgSrc.replace("const FIREBASE_CONFIG", "var FIREBASE_CONFIG"));

/* Only look inside the named function's body, so a UID mentioned in a
   comment elsewhere in the rules does not count as configured. */
function rulesBody(fnName) {
  const block = rules.match(new RegExp("function " + fnName + "\\(\\)\\s*\\{[\\s\\S]*?\\}"));
  return block ? block[0] : "";
}

function uidsInRules(fnName) {
  return [...rulesBody(fnName).matchAll(/'([A-Za-z0-9_-]{20,64})'/g)].map(m => m[1]).sort();
}

/* deviceBins() is a map, so both halves of each pair matter: the same UID
   pointed at a different bin in the two files is a mismatch, not a match. */
function deviceMapInRules() {
  const pairs = [...rulesBody("deviceBins").matchAll(/'([A-Za-z0-9_-]{20,64})'\s*:\s*'(BIN-[0-9]{3})'/g)];
  return pairs.map(m => m[1] + " -> " + m[2]).sort();
}

function clean(list) {
  return (Array.isArray(list) ? list : []).map(u => String(u || "").trim()).filter(Boolean).sort();
}

let failures = 0;

/* One list, two sources, printed the same way every time. */
function compare(title, fromConfig, fromRules, opts) {
  opts = opts || {};
  const same = JSON.stringify(fromConfig) === JSON.stringify(fromRules);

  console.log("  " + title);
  console.log("    firebase-config.js : " + (fromConfig.join(", ") || "(none)"));
  console.log("    firestore.rules    : " + (fromRules.join(", ") || "(none)"));

  if (same && fromConfig.length) {
    console.log("    OK - " + fromConfig.length + " " + opts.noun + "(s), both lists agree.");
  } else if (same) {
    if (opts.emptyIsOk) {
      console.log("    Not configured yet - empty in both files, which is consistent.");
      console.log("    " + opts.emptyHint);
    } else {
      console.log("    NOTHING CONFIGURED - this list must not be empty.");
      failures++;
    }
  } else {
    console.log("    MISMATCH - these lists must be identical.");
    fromConfig.filter(u => !fromRules.includes(u))
      .forEach(u => console.log("      in the config but NOT in the rules: " + u));
    fromRules.filter(u => !fromConfig.includes(u))
      .forEach(u => console.log("      in the rules but NOT in the config: " + u));
    failures++;
  }
  console.log("");
}

console.log("");

compare(
  "Owners",
  clean(FIREBASE_CONFIG.OWNER_UIDS || [FIREBASE_CONFIG.OWNER_UID]),
  uidsInRules("ownerUids"),
  { noun: "owner" }
);

compare(
  "Collection crew (COLLECTOR_UIDS / collectorUids)",
  clean(FIREBASE_CONFIG.COLLECTOR_UIDS),
  uidsInRules("collectorUids"),
  { noun: "crew account", emptyIsOk: true,
    emptyHint: "Create it: Authentication > enable Email/Password, add " +
               String(FIREBASE_CONFIG.COLLECTOR_EMAIL || "the crew address") +
               ", then paste its UID into both files." }
);

const cfgDevices = Object.keys(FIREBASE_CONFIG.DEVICE_BINS || {})
  .map(uid => String(uid).trim() + " -> " + String(FIREBASE_CONFIG.DEVICE_BINS[uid]).trim())
  .sort();

compare(
  "Devices (DEVICE_BINS / deviceBins)",
  cfgDevices,
  deviceMapInRules(),
  { noun: "device", emptyIsOk: true,
    emptyHint: "Only needed for a real ESP32 or a Wokwi board - the site is " +
               "fully working without one." }
);

if (!failures) {
  console.log("  Remember the rules only take effect once Published in the");
  console.log("  Firebase console.\n");
  process.exit(0);
}

process.exit(1);
