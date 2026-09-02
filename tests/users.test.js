/* ==========================================================================
   Tests for the user registry - website/assets/js/users.js
   Run:  node tests/users.test.js

   NOTE ON PRIVACY
   This file contains no real email addresses, on purpose. The registry
   stores addresses as SHA-256 hashes so that a public repository does not
   publish the team's personal addresses - and a test suite that hard-coded
   those addresses to check the hashes would hand them straight back. The
   logic is therefore exercised against synthetic addresses injected into a
   throwaway registry, and the real registry is checked only through
   properties that reveal nothing: how many administrators exist, and that
   unknown addresses are refused.
   ========================================================================== */

const fs   = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

global.self = { crypto: webcrypto };

const REGISTRY = path.join(__dirname, "../website/assets/js/users.js");
const src = fs.readFileSync(REGISTRY, "utf8");
eval(src.replace("const USER_DB", "var USER_DB").replace("const Users", "var Users"));

let pass = 0, fail = 0;
function check(name, ok) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name);
  ok ? pass++ : fail++;
}

/* Keep a copy so the synthetic tests can restore it. */
const REAL_USERS = USER_DB.USERS.slice();

(async () => {

  console.log("\nThe real registry - checked without naming anyone");
  check("six administrators are configured", Users.adminCount() === 6);
  check("every entry is stored as a hash",
        REAL_USERS.every(u => u.emailHash && !u.email));
  check("every hash is a 64-character hex digest",
        REAL_USERS.every(u => /^[0-9a-f]{64}$/i.test(u.emailHash)));
  check("all hashes are distinct",
        new Set(REAL_USERS.map(u => u.emailHash.toLowerCase())).size === REAL_USERS.length);
  check("every entry has a display name",
        REAL_USERS.every(u => typeof u.name === "string" && u.name.length > 0));

  console.log("\nNo personal address is committed anywhere");
  /* The needle is assembled at runtime. A literal here would match its own
     source, and the check would fail on itself. */
  const NEEDLE = "@" + "gmail" + ".com";
  check("no personal-address literal in the registry", src.indexOf(NEEDLE) === -1);
  check("no personal-address literal in this test file",
        fs.readFileSync(__filename, "utf8").indexOf(NEEDLE) === -1);

  console.log("\nStrangers are refused (real registry, unknown addresses)");
  for (const stranger of [
    "someone@example.com", "attacker@evil.test", "admin@example.org", ""
  ]) {
    const d = await Users.resolve(stranger);
    check('refused: "' + stranger + '"', d.allowed === false && d.role === null);
  }

  /* ---------------------------------------------------------------------
     From here the registry is replaced with synthetic entries, so the
     matching logic can be tested against addresses we are free to print.
     ------------------------------------------------------------------- */
  const KNOWN = "Owner.Person@Example.com";
  USER_DB.USERS = [
    { emailHash: await Users.sha256Hex(KNOWN.toLowerCase()), name: "Owner",  role: "admin"  },
    { email: "plain.reader@example.com",                     name: "Reader", role: "viewer" }
  ];

  console.log("\nHashed entries match");
  check("exact address matches",   (await Users.resolve("owner.person@example.com")).role === "admin");
  check("uppercase matches",       (await Users.resolve("OWNER.PERSON@EXAMPLE.COM")).role === "admin");
  check("mixed case matches",      (await Users.resolve(KNOWN)).role === "admin");
  check("surrounding spaces trimmed",
        (await Users.resolve("   owner.person@example.com  ")).role === "admin");
  check("the display name comes from the registry",
        (await Users.resolve(KNOWN)).name === "Owner");

  console.log("\nPlain-text entries still work alongside hashed ones");
  check("plain entry matches",     (await Users.resolve("plain.reader@example.com")).role === "viewer");
  check("plain entry is case-insensitive",
        (await Users.resolve("Plain.Reader@Example.com")).role === "viewer");

  console.log("\nNear misses are refused, not fuzzy-matched");
  for (const near of [
    "owner.person@example.co",        // truncated TLD
    "owner.person@examples.com",      // different domain
    "ownerperson@example.com",        // dot removed
    "owner.person+admin@example.com", // plus alias
    "owner.perso@example.com",        // one letter short
    "owner.person@example.com.evil.test"
  ]) {
    check('refused: "' + near + '"', (await Users.resolve(near)).allowed === false);
  }

  USER_DB.USERS = REAL_USERS;   /* restore */

  console.log("\nThe published demo login cannot control the fleet");
  check("demo role is viewer",           USER_DB.DEMO_LOGIN_ROLE === "viewer");
  const viewer = Users.permissions("viewer");
  check("viewer cannot control bins",    viewer.canControlBins === false);
  check("viewer cannot bulk act",        viewer.canBulkAct === false);
  check("viewer cannot reset the demo",  viewer.canResetDemo === false);
  check("viewer MAY plan a route",       viewer.canPlanRoute === true);

  console.log("\nAdministrators can");
  const admin = Users.permissions("admin");
  check("admin can control bins", admin.canControlBins === true);
  check("admin can bulk act",     admin.canBulkAct === true);
  check("admin can reset demo",   admin.canResetDemo === true);
  check("admin can plan a route", admin.canPlanRoute === true);

  console.log("\nUnknown roles fail closed");
  check("unknown role gets viewer permissions",   Users.permissions("superuser").canControlBins === false);
  check("undefined role gets viewer permissions", Users.permissions(undefined).canControlBins === false);
  check("role label falls back safely",           Users.roleLabel("nonsense") === "Viewer");

  console.log("\nStrict mode is on");
  check("unknown accounts are denied, not admitted read-only",
        USER_DB.DEFAULT_ROLE_FOR_UNKNOWN === "deny");

  console.log("\n----------------------------------------");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("----------------------------------------\n");
  process.exit(fail ? 1 : 0);
})();
