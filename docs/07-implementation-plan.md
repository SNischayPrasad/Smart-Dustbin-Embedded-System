# 7. Implementation Plan

Twelve phases. Each one has an objective, the tasks, what you should see when
it works, the mistakes people actually make, and how to prove it is done.

**Rule for the whole plan: never move to the next phase while the current one
is broken.** Debugging one new component is easy; debugging four at once is not.

---

## Phase 1 - Development environment setup

**Objective:** be able to compile and upload a program.

**Tasks**
1. Install the Arduino IDE 2.x from arduino.cc.
2. Plug in the UNO, then Tools > Board > Arduino UNO, and Tools > Port > the COM port that just appeared.
3. Open File > Examples > 01.Basics > Blink and upload it.
4. Install the libraries: Sketch > Include Library > Manage Libraries, then search for **Servo** and **LiquidCrystal I2C** (by Frank de Brabander).
5. No hardware? Open wokwi.com instead and skip straight to Phase 3.

**Expected output:** the onboard LED on pin 13 blinks once per second.

**Common mistakes**
- No COM port listed - the USB cable is charge-only. Try a different cable first.
- `avrdude: stk500_recv(): programmer is not responding` - wrong board or port, or another window has the Serial Monitor holding the port open.
- Installing "LiquidCrystal" instead of "LiquidCrystal I2C". They are different libraries.

**Verify:** Blink runs. Screenshot the IDE showing "Done uploading".

---

## Phase 2 - Component selection

**Objective:** know exactly what you are building before you wire anything.

**Tasks**
1. Read `docs/03-tech-stack-options.md` and pick Option A, B or C.
2. Check every component against `docs/05-components.md`.
3. Confirm your buzzer is **active**, not passive - touch it briefly to 5 V and GND; if it sounds, it is active.
4. Identify the long leg (anode) on both LEDs.

**Expected output:** a written bill of materials with quantities.

**Common mistakes**
- Buying one HC-SR04 and discovering later that the project needs two.
- Buying an MG996R servo, which is far too powerful and current-hungry for a lid.

**Verify:** every row of the BOM table in `05-components.md` is ticked off.

---

## Phase 3 - Circuit creation

**Objective:** a wired circuit that powers up without smoke.

**Tasks**
1. Follow the step-by-step order in `circuit_diagram/connections.md`.
2. Power rails first, then one component at a time.
3. Keep to the colour convention: red for 5 V, black for GND, other colours for signals.
4. In Wokwi, import `simulation/wokwi/diagram.json` and this phase is done in one step.

**Expected output:** the board powers on, the power LED is lit, nothing gets warm.

**Common mistakes**
- Forgetting the GND rail back to the Arduino. Everything then behaves randomly.
- 5 V and GND swapped on a sensor - it gets hot immediately. Unplug at once.
- LEDs wired with no series resistor.

**Verify:** photograph the wired board and check it against the pin table.

---

## Phase 4 - Ultrasonic sensor interfacing

**Objective:** get a trustworthy distance number out of sensor 1.

**Tasks**
1. Upload `arduino_code/01_lid_module` and watch the distance print.
2. Open the Serial Monitor at **9600 baud**.
3. Hold a flat book at a measured 10 cm, then 20 cm, then 30 cm, and compare.

**Expected output:**
```
Distance: 24.6 cm   Lid: CLOSED
Distance: 11.2 cm   Lid: OPEN
```

**Common mistakes**
- Baud rate mismatch produces garbage characters. It must be 9600 at both ends.
- TRIG and ECHO swapped: the reading is always 0 or nothing.
- Aiming at a curtain or a jumper - soft surfaces absorb ultrasound and return no echo.

**Verify:** readings track a tape measure within about 1 cm from 5 to 50 cm.

---

## Phase 5 - Servo motor interfacing

**Objective:** the servo moves to commanded angles.

**Tasks**
1. Upload the Sweep example, or just watch the self test in the full sketch.
2. Confirm that 0 and 90 degrees correspond to your closed and open lid.
3. Adjust `ANGLE_CLOSED` and `ANGLE_OPEN` to fit your mechanism.

**Expected output:** smooth movement between the two positions, with no buzzing at rest.

**Common mistakes**
- The board browns out and resets when the servo moves - the USB port cannot supply the current. Use an external 5 V supply and join the grounds.
- Continuous jitter - usually a shared-ground problem, or a servo being asked to hold against a mechanical stop.

**Verify:** video the servo sweeping between both positions.

---

## Phase 6 - Automatic lid logic

**Objective:** join Phase 4 and Phase 5 into a working touchless lid.

**Tasks**
1. Upload the complete `01_lid_module`.
2. Wave a hand and watch it open.
3. Step back and time the close - it should be about 3 s.
4. Test the safety case: put your hand back while it is closing.

**Expected output:**
```
>>> HAND DETECTED - LID OPENING
<<< NO HAND - LID CLOSING
```

**Common mistakes**
- Using `delay(3000)` to hold the lid open. It works today and blocks everything you add tomorrow. Use the timestamp pattern instead.
- The lid oscillating open and closed at exactly 25 cm - the hold timer is what fixes this, and this sketch already has it.

**Verify:** ten consecutive hand waves all open the lid. Record it.

---

## Phase 7 - Bin level detection

**Objective:** turn the two in-bin sensors into one fill percentage.

**Tasks**
1. Upload `arduino_code/02_bin_level_module`.
2. **Calibrate:** with the bin empty, read both printed distances. They should agree within about 1 cm - if not, the sensors are not mounted level with each other. Put that number into `BIN_HEIGHT_CM`.
3. Put an object of known height inside and check that the percentage matches.
4. Put the object under **one** sensor only, and confirm `UNEVEN LOAD` appears while the fused value stays near the average.

**Expected output:**
```
A: 15.1 cm = 50%   |   B: 14.9 cm = 50%   |   FUSED: 50%  OK
     [##########----------] 50%
```

**Common mistakes**
- Leaving `BIN_HEIGHT_CM` at the default 30 without calibrating - every reading is then wrong.
- Mounting the two level sensors side by side instead of on opposite diagonals - you then gain nothing over a single sensor.
- Testing with a single crumpled bag: the surface is uneven, so the reading moves a little. That is real, not a bug.

**Verify:** empty reads 0 %, half full reads close to 50 %, nearly full reads above 90 %.

---

## Phase 8 - LED and buzzer alert logic

**Objective:** make the status visible and audible.

**Tasks**
1. Upload `arduino_code/03_alert_module`, which ramps a simulated fill level.
2. Watch the green LED, the red blink and the chirp appear at the right thresholds.

**Expected output:** green under 75 %, red blinking from 75 to 89 %, red solid plus a chirp at 90 %.

**Common mistakes**
- Using `delay()` for the blink, which then blocks the sensors.
- A continuous buzzer tone. It is unbearable within a minute; use the duty cycle.
- Forgetting the LED series resistors.

**Verify:** record the LED behaviour as it crosses each threshold.

---

## Phase 9 - LCD / OLED integration (optional)

**Objective:** a local readout.

**Tasks**
1. Wire SDA to A4 and SCL to A5.
2. Run an I2C scanner sketch to find the address, then set it in the code.
3. Keep `#define USE_LCD` enabled.

**Expected output:**
```
Lid:CLOSED
Fill: 76% WARNING
```

**Common mistakes**
- Wrong address. 0x27 and 0x3F are both common.
- Backlight on but no characters - turn the contrast trimmer on the back of the backpack.
- Redrawing the screen every loop, which flickers. Only redraw when the text changes.

**Verify:** photograph the LCD showing a real reading.

---

## Phase 10 - Complete system integration

**Objective:** everything running together.

**Tasks**
1. Upload `arduino_code/04_smart_dustbin_complete`.
2. Watch the power-on self test complete.
3. Exercise the lid while the bin is full and confirm both subsystems still work.
4. Try the serial commands: `HELP`, `STATUS`, `MUTE`, `EMPTY`.

**Expected output:** the banner, then telemetry every 2 s, with the lid responding throughout.

**Common mistakes**
- The three sensors interfering. The firmware spaces every ping by 12 ms, which fixes it - if you rewrite the timing, keep that gap.
- Measuring the level while the lid is open. The firmware skips it; do not remove that check.

**Verify:** a two-minute video covering every feature, plus a Serial Monitor screenshot.

---

## Phase 11 - Testing and calibration

**Objective:** evidence, not opinion.

**Tasks**
1. Work through all 14 test cases in `docs/13-testing-strategy.md`.
2. Record the actual result for each one in `data/test_results.csv`.
3. Re-calibrate `BIN_HEIGHT_CM` after the final mechanical assembly.
4. Deliberately break something - unplug sensor 2 - and confirm the fast red blink appears.

**Expected output:** a completed results table with a pass or fail against every case.

**Common mistakes**
- Only testing the happy path. The interesting cases are the sensor fault and the rapid repeated wave.
- Not writing the results down at the time.

**Verify:** `data/test_results.csv` is filled in and committed.

---

## Phase 12 - GitHub upload

**Objective:** the project becomes visible proof of work.

**Tasks**
1. Follow `docs/15-github-strategy.md` exactly.
2. Commit in the day-by-day order from `docs/17-proof-plan.md` rather than in one dump.
3. Add every screenshot from `docs/18-screenshot-checklist.md`.
4. Set the repository description and topics.

**Expected output:** a repository with a clear README, a real commit history, and images that render.

**Common mistakes**
- One commit called "final". It tells a reviewer nothing about how you worked.
- Broken image links, because the paths are absolute instead of relative.
- Committing a 200 MB demo video. Keep media small, or link to it.

**Verify:** open the repository in a private browser window and check that the README renders and every image loads.

---

## Suggested schedule

| Days | Phases | Deliverable |
|---|---|---|
| 1 | 1, 2 | Toolchain works, BOM finalised |
| 2 | 3, 4 | Circuit wired, sensor 1 reading correctly |
| 3 | 5, 6 | Touchless lid working end to end |
| 4 | 7 | Fill percentage calibrated |
| 5 | 8, 9 | Alerts and display |
| 6 | 10 | Full integration |
| 7 | 11 | Test results recorded |
| 8 | 12 | Repository published |

Two weeks is comfortable. One week is achievable if you simulate rather than
wire, because Phases 3 to 5 collapse into a single import.
