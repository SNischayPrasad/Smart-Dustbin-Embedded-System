#!/usr/bin/env node
/* ==========================================================================
   Run every Node test suite in tests/ and print one summary.

     node tools/run-tests.js

   Each suite is a plain script that prints "N passed, M failed" and exits
   non-zero if anything failed, so there is no framework to install and each
   one still runs on its own when you are working on it:

     node tests/twin.test.js

   The Firestore Security Rules have their own suite (tests/rules/), because
   it needs the Firebase emulator and Java. It is not run from here - see
   tests/rules/README.md.
   ========================================================================== */

const fs   = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const TESTS = path.join(__dirname, "..", "tests");

/* Alphabetical, so the output is the same order every time. */
const suites = fs.readdirSync(TESTS)
  .filter(f => f.endsWith(".test.js"))
  .sort();

let failedSuites = 0, totalPass = 0, totalFail = 0;
const rows = [];

suites.forEach(function (file) {
  let out = "", ok = true;
  try {
    out = execFileSync(process.execPath, [path.join(TESTS, file)],
                       { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    ok = false;
    out = (e.stdout || "") + (e.stderr || "");
  }

  /* Each suite ends with a line like "  88 passed, 0 failed". */
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const pass = m ? Number(m[1]) : 0;
  const fail = m ? Number(m[2]) : 0;

  totalPass += pass;
  totalFail += fail;
  if (!ok || fail > 0 || !m) failedSuites++;

  rows.push({ file: file, pass: pass, fail: fail, ok: ok && fail === 0 && !!m });

  /* A crash is not a failed assertion - show it, or it is invisible. */
  if (!m) {
    console.log("\n--- " + file + " produced no summary line ---");
    console.log(out.trim().split("\n").slice(-12).join("\n"));
  }
});

console.log("");
rows.forEach(function (r) {
  console.log("  " + (r.ok ? "PASS" : "FAIL") + "  " +
              r.file.replace(".test.js", "").padEnd(10) +
              String(r.pass).padStart(4) + " passed" +
              (r.fail ? ", " + r.fail + " failed" : ""));
});
console.log("  " + "-".repeat(38));
console.log("  " + totalPass + " checks passed, " + totalFail + " failed, in " +
            suites.length + " suites");
console.log("  (the Security Rules suite runs separately: tests/rules/README.md)\n");

process.exit(failedSuites ? 1 : 0);
