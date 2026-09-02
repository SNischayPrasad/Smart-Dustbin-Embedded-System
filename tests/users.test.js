/* ==========================================================================
   Tests for the user registry - website/assets/js/users.js
   Run:  node tests/users.test.js

   The requirement being verified: nischayprasuna@gmail.com is the ONLY
   account with administrator access, and the published demo credentials
   cannot control the fleet.
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

global.self = { crypto: webcrypto };

const src = fs.readFileSync(path.join(__dirname, "../website/assets/js/users.js"), "utf8");
eval(src.replace("const USER_DB", "var USER_DB").replace("const Users", "var Users"));

let pass = 0, fail = 0;
function check(name, ok) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name);
  ok ? pass++ : fail++;
}

(async () => {
  console.log("\nThe owner is the only administrator");
  const owner = await Users.resolve("nischayprasuna@gmail.com");
  check("owner is allowed",              owner.allowed === true);
  check("owner is an administrator",     owner.role === "admin");
  check("owner is recognised, not a guest", owner.known === true);
  check("exactly one admin configured",  Users.adminCount() === 1);

  console.log("\nThe address is matched by hash, not stored in plain text");
  const raw = fs.readFileSync(path.join(__dirname, "../website/assets/js/users.js"), "utf8");
  check("plain address absent from the file", raw.indexOf("nischayprasuna@gmail.com") === -1);
  check("hash present in the file",
        raw.indexOf("007dda63f0cb9774705083417edbff84332b237f6c480330df303865e60efc87") !== -1);
  check("hash of the address is correct",
        (await Users.sha256Hex("nischayprasuna@gmail.com")) ===
        "007dda63f0cb9774705083417edbff84332b237f6c480330df303865e60efc87");

  console.log("\nAddress normalisation");
  check("uppercase matches",       (await Users.resolve("NISCHAYPRASUNA@GMAIL.COM")).role === "admin");
  check("mixed case matches",      (await Users.resolve("NischayPrasuna@Gmail.com")).role === "admin");
  check("leading/trailing spaces", (await Users.resolve("  nischayprasuna@gmail.com  ")).role === "admin");

  console.log("\nEveryone else is refused");
  for (const stranger of [
    "someone@gmail.com",
    "nischayprasuna@googlemail.com",
    "nischayprasuna@gmail.co",
    "nischayprasuna+admin@gmail.com",
    "nischayprasun@gmail.com",
    "attacker@evil.com",
    ""
  ]) {
    const d = await Users.resolve(stranger);
    check('refused: "' + stranger + '"', d.allowed === false && d.role === null);
  }

  console.log("\nThe published demo login cannot control the fleet");
  check("demo role is viewer",             USER_DB.DEMO_LOGIN_ROLE === "viewer");
  const viewer = Users.permissions("viewer");
  check("viewer cannot control bins",     viewer.canControlBins === false);
  check("viewer cannot bulk act",         viewer.canBulkAct === false);
  check("viewer cannot reset the demo",   viewer.canResetDemo === false);
  check("viewer MAY plan a route (read-only computation)", viewer.canPlanRoute === true);

  console.log("\nAdministrators can");
  const admin = Users.permissions("admin");
  check("admin can control bins",  admin.canControlBins === true);
  check("admin can bulk act",      admin.canBulkAct === true);
  check("admin can reset demo",    admin.canResetDemo === true);
  check("admin can plan a route",  admin.canPlanRoute === true);

  console.log("\nUnknown roles fail closed");
  const bogus = Users.permissions("superuser");
  check("unknown role gets viewer permissions", bogus.canControlBins === false);
  check("undefined role gets viewer permissions",
        Users.permissions(undefined).canControlBins === false);
  check("role label falls back safely", Users.roleLabel("nonsense") === "Viewer");

  console.log("\nStrict mode is on");
  check("unknown accounts are denied, not admitted read-only",
        USER_DB.DEFAULT_ROLE_FOR_UNKNOWN === "deny");

  console.log("\n----------------------------------------");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("----------------------------------------\n");
  process.exit(fail ? 1 : 0);
})();
