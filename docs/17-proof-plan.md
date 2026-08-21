# 17. Proof Building Strategy

A day-by-day plan that turns the project into visible evidence of work.
Commit at the end of each day. Eight small commits beat one large one, because
the history itself is part of the proof.

---

## Day 1 - Project setup and component planning

**Files to commit**
```
.gitignore
README.md
docs/01-project-explanation.md
docs/02-industry-relevance.md
docs/03-tech-stack-options.md
docs/05-components.md
docs/08-folder-structure.md
```

**Commit message**
```
docs: project brief, component selection and folder structure
```

**Proof to capture**
- `screenshots/01-folder-structure.png` - the project tree in your file explorer or `tree` output
- A photo of the components laid out, if you have hardware

---

## Day 2 - Ultrasonic sensor interfacing

**Files to commit**
```
arduino_code/01_lid_module/
circuit_diagram/connections.md
circuit_diagram/smart_dustbin_circuit.svg
docs/09-circuit-diagram.md
```

**Commit message**
```
feat: HC-SR04 hand detection with echo timing and range validation
```

**Proof to capture**
- `screenshots/02-circuit-diagram.png`
- `screenshots/03-wokwi-full-circuit.png`
- Serial Monitor showing distance tracking your hand

---

## Day 3 - Servo-based automatic lid

**Files to commit**
```
arduino_code/01_lid_module/  (completed)
src/lid.h  src/lid.cpp
src/ultrasonic.h  src/ultrasonic.cpp
src/config.h
```

**Commit message**
```
feat: non-blocking four-state lid machine with safety re-open
```

**Proof to capture**
- `screenshots/04-lid-closed-state.png`
- `screenshots/05-object-detected.png`
- `screenshots/06-lid-open-state.png`
- A short video of the lid opening and closing

---

## Day 4 - Bin-level detection with two in-bin sensors

**Files to commit**
```
arduino_code/02_bin_level_module/
src/bin_level.h  src/bin_level.cpp
docs/12-bin-level-calculation.md
data/calibration_table.csv
```

**Commit message**
```
feat: fuse two in-bin ultrasonic sensors into one fill percentage
```

**Proof to capture**
- `screenshots/07-empty-bin-reading.png`
- `screenshots/08-half-full-reading.png`
- `screenshots/14-uneven-load.png` - **the important one**: A at 90 %, B at 10 %, fused 50 %, `UNEVEN LOAD` raised

---

## Day 5 - Buzzer and LED alert logic

**Files to commit**
```
arduino_code/03_alert_module/
src/alert.h  src/alert.cpp
```

**Commit message**
```
feat: three-band alert policy with non-blocking buzzer duty cycle
```

**Proof to capture**
- `screenshots/09-warning-75.png` - red LED blinking
- `screenshots/10-full-bin-alert.png` - red solid, buzzer active
- A video with sound, so the chirp pattern is audible

---

## Day 6 - Complete system integration

**Files to commit**
```
arduino_code/04_smart_dustbin_complete/
arduino_code/05_esp32_wifi_version/
src/main.cpp  src/display.h  src/display.cpp
docs/06-architecture.md
docs/10-source-code-guide.md
```

**Commit message**
```
feat: integrate all subsystems under a non-blocking cooperative scheduler
```

**Proof to capture**
- `screenshots/11-serial-monitor.png` - a long capture including the boot banner
- `screenshots/12-lcd-display.png`
- `screenshots/13-serial-commands.png`
- `screenshots/15-degraded-sensor.png` - one level sensor unplugged, `sensors=1`

---

## Day 7 - Virtual simulation and testing

**Files to commit**
```
simulation/wokwi/
simulation/tinkercad/
tests/twin.test.js
data/sample_serial_output.txt
data/test_results.csv       (filled in)
docs/11-virtual-simulation.md
docs/13-testing-strategy.md
```

**Commit message**
```
test: 64 automated logic assertions plus the recorded hardware test matrix
```

**Proof to capture**
- Terminal output of `node tests/twin.test.js` showing **64 passed, 0 failed**
- The completed `data/test_results.csv`
- Your public Wokwi share link

---

## Day 8 - Website, dashboard and documentation

**Files to commit**
```
website/
server/
docs/14-how-to-run.md
docs/15-github-strategy.md
docs/16-website-guide.md
docs/17-proof-plan.md
docs/18-screenshot-checklist.md
docs/19-interview-preparation.md
reports/
README.md   (final version)
```

**Commit message**
```
feat: public status site and admin console with live map and firmware twin
```

**Proof to capture**
- `screenshots/16-website-public.png`
- `screenshots/17-admin-login.png`
- `screenshots/18-admin-dashboard.png`
- `screenshots/19-github-repo.png`
- `screenshots/20-readme-preview.png`

---

## Why staged commits matter

A reviewer looking at your repository sees the commit list before they see any
code. Compare:

```
* final                          <- tells them nothing
```

against:

```
* feat: public status site and admin console with live map
* test: 64 automated logic assertions plus recorded hardware tests
* feat: integrate all subsystems under a cooperative scheduler
* feat: three-band alert policy with non-blocking buzzer duty cycle
* feat: fuse two in-bin ultrasonic sensors into one fill percentage
* feat: non-blocking four-state lid machine with safety re-open
* feat: HC-SR04 hand detection with echo timing and range validation
* docs: project brief, component selection and folder structure
```

The second one is a narrative. It shows you built the system in layers, tested
it, and documented it - which is exactly the claim you want to make in an
interview, evidenced rather than asserted.

**Commit on the day you do the work.** GitHub timestamps are visible, and a
history spread over eight days reads as real work, while eight commits pushed
in one minute on the deadline does not.
