/* Node test for the firmware twin - run with:  node tests/twin.test.js
   It checks the SAME logic that the Arduino sketch implements, so a change
   in a threshold that breaks the behaviour is caught before you flash a board. */
const fs = require("fs");
const path = require("path");
eval(fs.readFileSync(path.join(__dirname, "../website/assets/js/sim.js"), "utf8"));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? "  PASS  " : "  FAIL  ") + name +
              (ok ? "" : "   expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)));
  ok ? pass++ : fail++;
}

/* ---------- 1. fill percentage maths ---------- */
const t = new FirmwareTwin();
console.log("\nBin level calculation (BIN_HEIGHT = 30 cm)");
check("30.0 cm -> 0%",   Math.round(t.calculateFillPercent(30.0)), 0);
check("22.5 cm -> 25%",  Math.round(t.calculateFillPercent(22.5)), 25);
check("15.0 cm -> 50%",  Math.round(t.calculateFillPercent(15.0)), 50);
check("7.5 cm  -> 75%",  Math.round(t.calculateFillPercent(7.5)),  75);
check("3.0 cm  -> 90%",  Math.round(t.calculateFillPercent(3.0)),  90);
check("0.0 cm  -> 100%", Math.round(t.calculateFillPercent(0.0)),  100);
check("clamp above bin height", Math.round(t.calculateFillPercent(45)), 0);
check("negative reading is the no-echo sentinel", t.calculateFillPercent(-5), -1);
check("negative sentinel -1 is invalid too",      t.calculateFillPercent(-1), -1);

/* ---------- 2. status bands ---------- */
console.log("\nStatus classification");
function statusAt(distance) {
  const s = new FirmwareTwin();
  s.wasteDistance = distance;
  s.step(0);
  return s.binStatus;
}
check("distance 30 -> OK",       statusAt(30),  "OK");
check("distance 15 -> OK",       statusAt(15),  "OK");
check("distance 7.5 -> WARNING", statusAt(7.5), "WARNING");
check("distance 4 -> WARNING",   statusAt(4),   "WARNING");
check("distance 3 -> FULL",      statusAt(3),   "FULL");
check("distance 0 -> FULL",      statusAt(0),   "FULL");

/* ---------- 3. lid state machine ---------- */
console.log("\nLid state machine");
const lid = new FirmwareTwin();
lid.handDistance = 80;
lid.step(0);
check("idle -> CLOSED", lid.lidState, "CLOSED");

lid.handDistance = 12;                 /* hand arrives */
lid.step(100);
check("hand at 12 cm -> OPENING", lid.lidState, "OPENING");
check("open counter incremented",  lid.openCount, 1);

lid.step(600);                         /* servo travel finished */
check("after 400 ms travel -> OPEN", lid.lidState, "OPEN");

lid.handDistance = 80;                 /* hand leaves at t = 600 */
lid.step(700);
check("hand gone, still OPEN inside hold", lid.lidState, "OPEN");

lid.step(3700);                        /* 3000 ms after last detection */
check("hold expired -> CLOSING", lid.lidState, "CLOSING");

lid.handDistance = 10;                 /* hand comes back mid-close */
lid.step(3800);
check("safety re-open -> OPENING", lid.lidState, "OPENING");

lid.handDistance = 80;
lid.step(4300); lid.step(7400);
check("finally CLOSING again", lid.lidState, "CLOSING");
lid.step(7900);
check("travel done -> CLOSED", lid.lidState, "CLOSED");

/* ---------- 4. detection threshold boundary ---------- */
console.log("\nHand detection threshold (25 cm)");
function opensAt(distance) {
  const s = new FirmwareTwin();
  s.handDistance = distance;
  s.step(50);
  return s.lidState;
}
check("24.9 cm opens", opensAt(24.9), "OPENING");
check("25.0 cm opens", opensAt(25.0), "OPENING");
check("25.1 cm stays closed", opensAt(25.1), "CLOSED");
check("1.5 cm (below sensor dead zone) ignored", opensAt(1.5), "CLOSED");

/* ---------- 5. level is not measured while the lid is open ---------- */
console.log("\nLevel measurement is skipped while the lid is open");
const skip = new FirmwareTwin();
skip.wasteDistance = 30; skip.step(0);
check("baseline empty", Math.round(skip.fillPercent), 0);
skip.handDistance = 10; skip.step(50); skip.step(500);
skip.wasteDistance = 0;                       /* arm in the way */
skip.step(1700);   /* past the 1 s sample interval, so only the lid rule can block it */
check("lid still OPEN at this point", skip.lidState, "OPEN");
check("reading ignored while OPEN", Math.round(skip.fillPercent), 0);
skip.handDistance = 80;
skip.step(5200); skip.step(5700);              /* hold expires, lid closes */
skip.step(6800);                               /* now the measurement is allowed */
check("measurement resumes once closed", Math.round(skip.fillPercent), 100);

/* ---------- 5b. dual in-bin sensor fusion ---------- */
console.log("\nDual in-bin sensor fusion");

function fused(dA, dB) {
  const f = new FirmwareTwin();
  f.wasteDistanceA = dA;
  f.wasteDistanceB = dB;
  f.step(0);
  return f;
}

let f = fused(15, 15);                     /* flat load, both agree */
check("flat load 15/15 -> 50%", Math.round(f.fillPercent), 50);
check("flat load is not uneven", f.unevenLoad, false);
check("both sensors healthy", f.validSensors, 2);
check("spread is zero", Math.round(f.fillSpread), 0);

f = fused(3, 27);                          /* peak under A, hollow under B */
check("A reads 90%", Math.round(f.fillA), 90);
check("B reads 10%", Math.round(f.fillB), 10);
check("fused average is 50%", Math.round(f.fillPercent), 50);
check("spread is 80 points", Math.round(f.fillSpread), 80);
check("flagged as uneven", f.unevenLoad, true);
check("single-sensor bin would have cried FULL", Math.round(f.fillA) >= 90, true);

f = fused(9, 6);                           /* mild slope, still even */
check("mild slope 70/80 -> 75% fused", Math.round(f.fillPercent), 75);
check("10-point spread is not uneven", f.unevenLoad, false);
check("75% fused -> WARNING", f.binStatus, "WARNING");

f = fused(-1, 3);                          /* sensor A unplugged */
check("degraded mode uses B only", Math.round(f.fillPercent), 90);
check("one sensor valid", f.validSensors, 1);
check("bin still reports FULL, not an error", f.binStatus, "FULL");

f = fused(15, -1);                         /* sensor B unplugged */
check("degraded mode uses A only", Math.round(f.fillPercent), 50);
check("still one sensor valid", f.validSensors, 1);

f = fused(-1, -1);                         /* both dead */
check("both dead -> SENSOR_ERROR", f.binStatus, "SENSOR_ERROR");
check("no sensors valid", f.validSensors, 0);

/* the uneven threshold boundary */
check("24-point spread is even",   fused(16.8, 13.2).unevenLoad, false);
check("26-point spread is uneven", fused(16.9, 13.1).unevenLoad, false);
check("40-point spread is uneven", fused(21, 9).unevenLoad, true);

/* ---------- 6. commands ---------- */
console.log("\nOperator commands");
const c = new FirmwareTwin();
c.command("OPEN");
check("OPEN forces lid open", c.lidState, "OPEN");
check("OPEN sets manual override", c.manualOverride, true);
c.handDistance = 80; c.step(9000);
check("automatic logic suppressed under override", c.lidState, "OPEN");
c.command("AUTO");
check("AUTO clears override", c.manualOverride, false);
c.wasteDistance = 1; c.step(9100);
check("bin now FULL", c.binStatus, "FULL");
c.command("MUTE");
check("MUTE disables buzzer", c.buzzerEnabled, false);
c.command("EMPTY");
check("EMPTY resets fill", Math.round(c.fillPercent), 0);
check("EMPTY resets open counter", c.openCount, 0);
check("unknown command is rejected", c.command("XYZ").slice(0, 3), "ERR");

console.log("\n----------------------------------------");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("----------------------------------------\n");
process.exit(fail ? 1 : 0);
